import inquirer from 'inquirer';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import fs_regular from 'fs';
import HiveKnowledge from './tools/hiveKnowledge.js';
import path from 'path';

// Load environment variables
dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Store assistants data locally
const ASSISTANTS_FILE = 'assistants.json';

const hiveKnowledge = new HiveKnowledge(openai);

class AIChatHistory {
    constructor(assistant) {
        this.assistant = assistant;
        this.assistant.threads = this.assistant.threads || {};
        this.openai = openai;
    }

    async addMessage(role, content) {
        try {
            const message = await this.openai.beta.threads.messages.create(
                this.assistant.threadId,
                {
                    role: role,
                    content: content
                }
            );

            if (!this.assistant.threads) {
                this.assistant.threads = {};
            }

            if (!this.assistant.threads[this.assistant.threadId]) {
                this.assistant.threads[this.assistant.threadId] = {
                    messageIds: []
                };
            }

            if (!this.assistant.threads[this.assistant.threadId].messageIds) {
                this.assistant.threads[this.assistant.threadId].messageIds = [];
            }

            const threadEntry = this.assistant.threads[this.assistant.threadId];
            threadEntry.messageIds.push(message.id);
            await this.saveAssistantChanges();
            return message;
        } catch (error) {
            throw error;
        }
    }

    async saveAssistantChanges() {
        try {
            const data = await fs.readFile('assistants.json', 'utf8');
            const assistants = JSON.parse(data);
            const index = assistants.findIndex(a => a.id === this.assistant.id);

            if (index !== -1) {
                assistants[index] = {
                    ...assistants[index],
                    threads: this.assistant.threads
                };
                await fs.writeFile(
                    'assistants.json',
                    JSON.stringify(assistants, null, 2),
                    'utf8'
                );
            }
        } catch (error) {
            throw error;
        }
    }

    async getMessageHistory() {
        try {
            const messages = await this.openai.beta.threads.messages.list(
                this.assistant.threadId,
                { order: 'asc' }
            );

            if (!this.assistant.threads) {
                this.assistant.threads = {};
            }

            if (!this.assistant.threads[this.assistant.threadId]) {
                this.assistant.threads[this.assistant.threadId] = {
                    messageIds: []
                };
            } else if (!this.assistant.threads[this.assistant.threadId].messageIds) {
                this.assistant.threads[this.assistant.threadId].messageIds = [];
            }

            const threadEntry = this.assistant.threads[this.assistant.threadId];
            const existingIds = new Set(threadEntry.messageIds);
            const newMessages = messages.data.filter(msg => !existingIds.has(msg.id));

            if (newMessages.length > 0) {
                threadEntry.messageIds.push(...newMessages.map(msg => msg.id));
                await this.saveAssistantChanges();
            }

            return messages.data;
        } catch (error) {
            throw error;
        }
    }

    async getMessageById(messageId) {
        try {
            const message = await this.openai.beta.threads.messages.retrieve(
                this.assistant.threadId,
                messageId
            );
            return message;
        } catch (error) {
            throw error;
        }
    }

    async runAssistant() {
        try {
            const run = await this.openai.beta.threads.runs.create(
                this.assistant.threadId,
                {
                    assistant_id: this.assistant.id,
                }
            );
            return run;
        } catch (error) {
            throw error;
        }
    }

    async waitForRun(runId) {
        try {
            let runStatus = await this.openai.beta.threads.runs.retrieve(
                this.assistant.threadId,
                runId
            );

            while (runStatus.status !== 'completed' && runStatus.status !== 'failed') {
                await new Promise(resolve => setTimeout(resolve, 1000));
                runStatus = await this.openai.beta.threads.runs.retrieve(
                    this.assistant.threadId,
                    runId
                );
            }

            if (runStatus.status === 'completed') {
                return runStatus;
            } else {
                throw new Error('Assistant run failed');
            }
        } catch (error) {
            throw error;
        }
    }
}

async function loadAssistants() {
    try {
        const data = await fs.readFile(ASSISTANTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

async function saveAssistants(assistants) {
    await fs.writeFile(ASSISTANTS_FILE, JSON.stringify(assistants, null, 2));
}

async function createAssistant() {
    const assistants = await loadAssistants();

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: 'Enter the assistant name:',
            validate: (input) => {
                const nameExists = assistants.some(assistant =>
                    assistant.name.toLowerCase() === input.toLowerCase()
                );
                if (nameExists) {
                    return 'An assistant with this name already exists. Please choose a different name.';
                }
                return true;
            }
        },
        {
            type: 'input',
            name: 'instructions',
            message: 'Enter the assistant instructions:',
        },
        {
            type: 'list',
            name: 'model',
            message: 'Select the model:',
            choices: ['gpt-4-turbo-preview', 'gpt-3.5-turbo-0125'],
        },
    ]);

    try {
        const assistant = await openai.beta.assistants.create({
            name: answers.name,
            instructions: answers.instructions,
            model: answers.model,
        });

        assistants.push({
            id: assistant.id,
            name: assistant.name,
            instructions: assistant.instructions,
            model: assistant.model
        });
        await saveAssistants(assistants);
    } catch (error) {
        throw error;
    }
}

async function viewAssistants() {
    try {
        const myAssistants = await openai.beta.assistants.list({
            order: "desc",
            limit: "100",
        });

        const assistants = await loadAssistants(); // Load local data for threads

        for (const assistant of myAssistants.data) {
            const localData = assistants.find(a => a.id === assistant.id);
            console.log(`\nName: ${assistant.name}`);
            console.log(`id: ${assistant.id}`);
            console.log(`Model: ${assistant.model}`);
            console.log(`Instructions: ${assistant.instructions}`);
            if (localData && localData.threads) {
                const threadNames = Object.values(localData.threads)
                    .map(thread => thread.name)
                    .filter(Boolean);
                console.log(`Chat History: ${threadNames.length ? threadNames.join(', ') : 'No chats yet'}`);
            }
            console.log('------------------------');
        }
    } catch (error) {
        console.error('Error fetching assistants:', error);
    }
}

async function useAssistant() {
    const assistants = await loadAssistants();
    if (assistants.length === 0) {
        return;
    }

    const { selectedAssistant } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedAssistant',
            message: 'Select an assistant to chat with:',
            choices: assistants.map(a => ({ name: a.name, value: a })),
        }
    ]);

    // Initialize threads if they don't exist
    selectedAssistant.threads = selectedAssistant.threads || {};

    let threadId;

    // If there are existing threads, let user choose or create new
    if (Object.keys(selectedAssistant.threads).length > 0) {
        const { threadChoice } = await inquirer.prompt([
            {
                type: 'list',
                name: 'threadChoice',
                message: 'Select a thread or create new:',
                choices: [
                    ...Object.entries(selectedAssistant.threads).map(([id, thread]) => ({
                        name: thread.name || `Thread ${id}`,
                        value: id
                    })),
                    { name: 'Create New Thread', value: 'new' }
                ]
            }
        ]);

        if (threadChoice === 'new') {
            const thread = await openai.beta.threads.create();
            const { threadName } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'threadName',
                    message: 'Enter a name for this thread:',
                    validate: (input) => input.trim().length > 0
                }
            ]);
            threadId = thread.id;
            selectedAssistant.threads[threadId] = {
                name: threadName,
                messageIds: []
            };
            await saveAssistants(assistants);
        } else {
            threadId = threadChoice;
        }
    } else {
        // If no threads exist, create first one
        const thread = await openai.beta.threads.create();
        const { threadName } = await inquirer.prompt([
            {
                type: 'input',
                name: 'threadName',
                message: 'Enter a name for this thread:',
                validate: (input) => input.trim().length > 0
            }
        ]);
        threadId = thread.id;
        selectedAssistant.threads[threadId] = {
            name: threadName,
            messageIds: []
        };
        await saveAssistants(assistants);
    }

    // Update the selected assistant's threadId for this session
    selectedAssistant.threadId = threadId;

    const history = new AIChatHistory(selectedAssistant);
    await history.getMessageHistory();

    while (true) {
        const { message } = await inquirer.prompt([
            {
                type: 'input',
                name: 'message',
                message: 'You:',
            }
        ]);

        if (message.toLowerCase() === 'exit') break;

        try {
            const userMessage = await history.addMessage('user', message);
            const run = await history.runAssistant();
            await history.waitForRun(run.id);
            const messages = await history.getMessageHistory();

            const assistantMessage = messages
                .filter(msg => msg.role === 'assistant')
                .pop();
            if (assistantMessage) {
                console.log('\nAssistant:', assistantMessage.content[0].text.value, '\n');
                history.assistant.messageIds = [...(history.assistant.messageIds || []), assistantMessage.id];
                await history.saveAssistantChanges();
            }
        } catch (error) {
            throw error;
        }
    }
}

// Add deleteAssistant function
async function deleteAssistant() {
    const assistants = await loadAssistants();
    if (assistants.length === 0) {
        console.log('No assistants found.');
        return;
    }

    const { selectedAssistant } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedAssistant',
            message: 'Select an assistant to delete:',
            choices: assistants.map(a => ({ name: a.name, value: a })),
        }
    ]);

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: `Are you sure you want to delete ${selectedAssistant.name}?`,
            default: false,
        }
    ]);

    if (!confirm) {
        console.log('Deletion cancelled.');
        return;
    }

    try {
        // Delete from OpenAI
        const response = await openai.beta.assistants.del(selectedAssistant.id);
        const updatedAssistants = assistants.filter(a => a.id !== selectedAssistant.id);
        await saveAssistants(updatedAssistants);

        console.log(`Successfully deleted assistant: ${selectedAssistant.name}`);
    } catch (error) {
        console.error('Error deleting assistant:', error.message);
    }
}

// Update the mainMenu function to include the delete option
async function mainMenu() {
    while (true) {
        const { choice } = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: 'What would you like to do?',
                choices: [
                    'Create Assistant',
                    'View Assistants',
                    'Use Assistant',
                    'Delete Assistant',
                    'View Chat History',
                    'Manage Honeycombs',
                    'Exit',
                ],
            },
        ]);

        switch (choice) {
            case 'Create Assistant':
                await createAssistant();
                break;
            case 'View Assistants':
                await viewAssistants();
                break;
            case 'Use Assistant':
                await useAssistant();
                break;
            case 'Delete Assistant':
                await deleteAssistant();
                break;
            case 'View Chat History':
                await viewChatHistory();
                break;
            case 'Manage Honeycombs':
                await manageHoneycombs();
                break;
            case 'Exit':
                console.log('Goodbye!');
                process.exit(0);
        }
    }
}

async function getUserInput() {
    const { input } = await inquirer.prompt([
        {
            type: 'input',
            name: 'input',
            message: 'You:',
        }
    ]);
    return input;
}

async function chat() {
    // First, let user select an assistant
    const assistants = await loadAssistants();
    if (assistants.length === 0) {
        console.log('No assistants found. Please create an assistant first.');
        return;
    }

    const { selectedAssistant } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedAssistant',
            message: 'Select an assistant to chat with:',
            choices: assistants.map(a => ({ name: a.name, value: a })),
        }
    ]);

    const history = new AIChatHistory(selectedAssistant);

    console.log(`\nChatting with ${selectedAssistant.name}`);
    console.log('Type "exit" to return to main menu\n');

    while (true) {
        const userInput = await getUserInput();
        if (userInput.toLowerCase() === 'exit') break;

        // Add user message and log it
        const userMessage = await history.addMessage('user', userInput);
        console.log('User Message Added:', userMessage);

        // Run the assistant
        const run = await history.runAssistant();
        await history.waitForRun(run.id);

        // Get and log the updated message history
        const messages = await history.getMessageHistory();
        console.log('\nCurrent Thread History:');
        messages.forEach(msg => {
            console.log(`${msg.role}: ${msg.content[0]?.text?.value}`);
            console.log(`Message ID: ${msg.id}`);
            console.log('---');
        });
    }
}

// Make sure to call the chat function
mainMenu().catch(console.error);

async function viewChatHistory() {
    const assistants = await loadAssistants();
    if (assistants.length === 0) {
        console.log('No assistants found.');
        return;
    }

    const { selectedAssistant } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedAssistant',
            message: 'Select an assistant to view chat history:',
            choices: assistants.map(a => ({ name: a.name, value: a })),
        }
    ]);

    // Convert threads object to array of entries with thread IDs
    const threadChoices = Object.entries(selectedAssistant.threads).map(([threadId, thread]) => ({
        name: `${thread.name || 'Thread'} (${thread.messageIds?.length || 0} messages)`,
        value: { threadId, ...thread }
    }));

    if (threadChoices.length === 0) {
        console.log('No chat history found for this assistant.');
        return;
    }

    const { selectedThread } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedThread',
            message: 'Select a thread to view:',
            choices: threadChoices,
        }
    ]);

    console.log('\n=== Chat History ===');
    console.log(`Assistant: ${selectedAssistant.name}`);
    console.log(`Thread ID: ${selectedThread.threadId}`);
    console.log(`Found ${selectedThread.messageIds?.length || 0} messages\n`);

    const history = new AIChatHistory(selectedAssistant);

    history.assistant.threadId = selectedThread.threadId;

    for (const messageId of selectedThread.messageIds) {
        try {
            const message = await history.getMessageById(messageId);
            const timestamp = new Date(message.created_at).toLocaleString();
            const role = message.role.charAt(0).toUpperCase() + message.role.slice(1);

            console.log(`[${timestamp}] ${role}:`);
            console.log(message.content[0].text.value);
            console.log('---');
        } catch (error) {
            console.log(`Could not retrieve message ${messageId}: ${error.message}`);
        }
    }

    await inquirer.prompt([
        {
            type: 'input',
            name: 'continue',
            message: 'Press Enter to return to main menu...',
        }
    ]);
}

async function manageHoneycombs() {
    while (true) {
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Honeycomb Management:',
                choices: [
                    'View Honeycombs',
                    'Create New Honeycomb',
                    'Return to Main Menu'
                ]
            }
        ]);

        if (action === 'Return to Main Menu') break;

        switch (action) {
            case 'Create New Honeycomb':
                await createNewHoneycomb();
                break;
            case 'View Honeycombs':
                await viewAndManageHoneycombs();
                break;
        }
    }
}

async function createNewHoneycomb() {
    const { name, description, includePath } = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: 'Enter honeycomb name:',
            validate: input => input.trim().length > 0
        },
        {
            type: 'input',
            name: 'description',
            message: 'Enter honeycomb description:',
            validate: input => input.trim().length > 0
        },
        {
            type: 'confirm',
            name: 'includePath',
            message: 'Do you want to include files from a folder?',
            default: false
        }
    ]);

    let folderPath = null;
    if (includePath) {
        const { path: inputPath } = await inquirer.prompt([
            {
                type: 'input',
                name: 'path',
                message: 'Enter folder path:',
                validate: async (input) => {
                    try {
                        const stats = await fs.stat(input);
                        if (!stats.isDirectory()) {
                            return 'Please enter a valid directory path';
                        }
                        // Check if directory contains any .txt files
                        const files = await fs.readdir(input);
                        const txtFiles = files.filter(file => file.endsWith('.txt'));
                        if (txtFiles.length === 0) {
                            return 'Directory must contain at least one .txt file';
                        }
                        return true;
                    } catch (error) {
                        return 'Please enter a valid directory path';
                    }
                }
            }
        ]);
        folderPath = inputPath;

        // Log the files found
        const files = await fs.readdir(folderPath);
        const txtFiles = files.filter(file => file.endsWith('.txt'));
        console.log(`Found ${txtFiles.length} .txt files in ${folderPath}:`, txtFiles);
    }

    try {
        console.log('Creating honeycomb with path:', folderPath);
        const honeycomb = await hiveKnowledge.createHoneycomb(name, description, folderPath);
        console.log(`Successfully created honeycomb: ${honeycomb.name}`);
        console.log('Honeycomb details:', honeycomb);
    } catch (error) {
        console.error('Error creating honeycomb:', error);
        console.error('Stack trace:', error.stack);
    }
}

async function viewAndManageHoneycombs() {
    const honeycombs = await hiveKnowledge.loadHoneycombs();

    if (honeycombs.length === 0) {
        console.log('No honeycombs found.');
        return;
    }

    const { selectedHoneycomb } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedHoneycomb',
            message: 'Select a honeycomb:',
            choices: [
                ...honeycombs.map(h => ({
                    name: `${h.name} - ${h.description} (${h.files.length} files)`,
                    value: h
                })),
                { name: 'Return', value: 'return' }
            ]
        }
    ]);

    if (selectedHoneycomb === 'return') return;

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `What would you like to do with ${selectedHoneycomb.name}?`,
            choices: [
                'View Details',
                'Add Files',
                'Delete Honeycomb',
                'Return'
            ]
        }
    ]);

    switch (action) {
        case 'View Details':
            console.log('\nHoneycomb Details:');
            console.log(`Name: ${selectedHoneycomb.name}`);
            console.log(`Description: ${selectedHoneycomb.description}`);
            console.log(`Created: ${new Date(selectedHoneycomb.created_at).toLocaleString()}`);
            console.log(`Files (${selectedHoneycomb.files.length}):`);
            selectedHoneycomb.files.forEach(file => {
                console.log(`- ${file.name} (${file.path})`);
            });
            await inquirer.prompt([
                {
                    type: 'input',
                    name: 'continue',
                    message: 'Press Enter to continue...'
                }
            ]);
            break;

        case 'Add Files':
            const { folderPath } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'folderPath',
                    message: 'Enter folder path containing new files:',
                    validate: async (input) => {
                        try {
                            const stats = await fs.stat(input);
                            if (!stats.isDirectory()) {
                                return 'Please enter a valid directory path';
                            }
                            const files = await fs.readdir(input);
                            const txtFiles = files.filter(file => file.endsWith('.txt'));
                            if (txtFiles.length === 0) {
                                return 'Directory must contain at least one .txt file';
                            }
                            return true;
                        } catch (error) {
                            return 'Please enter a valid directory path';
                        }
                    }
                }
            ]);
            try {
                console.log('Adding files from:', folderPath);
                await hiveKnowledge.addFilesToHoneycomb(selectedHoneycomb.id, folderPath);
                console.log('Successfully added all files to honeycomb');
            } catch (error) {
                console.error('Error adding files:', error);
                console.error('Stack trace:', error.stack);
            }
            break;

        case 'Delete Honeycomb':
            const { confirm } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: `Are you sure you want to delete ${selectedHoneycomb.name}?`,
                    default: false
                }
            ]);
            if (confirm) {
                try {
                    await hiveKnowledge.deleteHoneycomb(selectedHoneycomb.id);
                    console.log(`Successfully deleted honeycomb: ${selectedHoneycomb.name}`);
                } catch (error) {
                    console.error('Error deleting honeycomb:', error.message);
                }
            }
            break;
    }
}
