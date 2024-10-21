require('dotenv').config();
const inquirer = require('inquirer');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = './agents.json';

const conversationFolder = './conversation_history';
if (!fs.existsSync(conversationFolder)) {
  fs.mkdirSync(conversationFolder);
}

// Connecting to Open AI 
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  
    //when the program is started this function loads the created ai into memory and their known chat history
    function loadAIAgents() {
        if (fs.existsSync(path)) {
          const data = fs.readFileSync(path);
          const agents = JSON.parse(data);
          console.log("\nLoaded AI agents:");
          console.table(agents.map(agent => ({ Name: agent.name, Role: agent.purpose, Memory: agent.storesMemory })));
          
          agents.forEach(agent => {
            if (agent.storesMemory) {
              loadConversationFromFile(agent);
            }
          });
          
          return agents;
        } else {
          console.log("\nNo agents found. Starting fresh...");
          return [];
        }
      }
  
  // Load the agents at the start
  let aiAgents = loadAIAgents();
//menu

function mainMenu() {
    console.log('\nWelcome to AI Agents!');
    inquirer
      .default.prompt([
        {
          type: 'list',
          name: 'menuChoice',
          message: 'Please choose an option:',
          choices: [
            '1. Create AI Agent',
            '2. View AI Agents',
            '3. Chat with an AI Agent',
            '4. Delete AI Agent',
            '5. Exit',
          ],
        },
      ])
      .then((answers) => {
        switch (answers.menuChoice) {
          case '1. Create AI Agent':
            createAIAgent();
            break;
          case '2. View AI Agents':
            viewAIAgents();
            break;
          case '3. Chat with an AI Agent':
            chooseAgentToChat();
            break;
          case '4. Delete AI Agent':
            deleteAIAgent();
            break;
          case '5. Exit':
            console.log('Goodbye!');
            process.exit();
          default:
            mainMenu();
        }
      })
      .catch((error) => {
        console.error('Error:', error);
      });
  }
  
  
  
  // Save AI agents to a file after created
  function saveAIAgents() {
    fs.writeFileSync(path, JSON.stringify(aiAgents, null, 2), (err) => {
      if (err) {
        console.error('Error saving agents:', err);
      } else {
        console.log('Agents saved successfully.');
      }
    });
  }
  
  // Function to create an AI agent 
  function createAIAgent() {
    inquirer.default.prompt([
      {
        type: 'input',
        name: 'agentName',
        message: 'What is this agent called?',
        //will create special key for every ai so multiple can have the same name easier to have unique names for now
        validate:(input) => {
            if (!input) {
              return 'Agent name cannot be empty.';
            }
            if (aiAgents.some((agent) => agent.name === input)) {
              return `Agent with name "${input}" already exists. Please choose a different name.`;
            }
            return true;
          },
      },
      {
        type: 'input',
        name: 'agentPurpose',
        message: 'What does this AI do?',
        validate: (input) => input ? true : 'Agent purpose cannot be empty.',
      },
      {
        type: 'confirm',
        name: 'storeMemory',
        message: 'Does this AI have long-term memory?',
        default: false,
      },
    ])
    .then((answers) => {
      const newAgent = {
        name: answers.agentName,
        purpose: answers.agentPurpose,
        storesMemory: answers.storeMemory,
        conversationHistory: answers.storeMemory ? [] : null,
      };

      //add agent to array
      // Save the agent in agents.json
      aiAgents.push(newAgent);
      saveAIAgents();
  
      console.log(`\nAgent "${newAgent.name}" has been created successfully!`);
      interactWithAgent(newAgent);
    })
    .catch((error) => {
      console.error('Error:', error);
    });
  }
  












  
  // Function to view AI agents
  function viewAIAgents() {
    if (aiAgents.length === 0) {
      console.log('\nNo AI agents have been created yet.');
    } else {
      console.log('\nList of AI Agents:');
      aiAgents.forEach((agent, index) => {
        console.log(`\nAgent ${index + 1}:`);
        console.log(`- Name: ${agent.name}`);
        console.log(`- Purpose: ${agent.purpose}`);
        console.log(`- Stores Memory: ${agent.storesMemory ? 'Yes' : 'No'}`);
      });
    }
    // Return to main menu
    mainMenu();
  }
  
  // Function to choose an agent to chat with
  function chooseAgentToChat() {
    if (aiAgents.length === 0) {
      console.log('\nNo AI agents have been created yet.');
      mainMenu();
      return;
    }
    inquirer
    .default.prompt([
        {
          type: 'list',
          name: 'selectedAgentIndex',
          message: 'Select an AI agent to chat with:',
          choices: aiAgents.map((agent, index) => ({
            name: agent.name,
            value: index,
          })),
        },
      ])
      .then((answers) => {
        const agent = aiAgents[answers.selectedAgentIndex];
        interactWithAgent(agent);
      })
      .catch((error) => {
        console.error('Error:', error);
      });
  }
  









  // Function to interact with the agent
  function interactWithAgent(agent) {
    console.log(`\nYou are now interacting with "${agent.name}"`);
    conversationLoop(agent);
  }
  
  function conversationLoop(agent) {
    inquirer
    .default.prompt([
        {
          type: 'input',
          name: 'userMessage',
          message: 'You:',
        },
      ])
      .then(async (answers) => {
        const userMessage = answers.userMessage;
        if (userMessage.toLowerCase() === 'exit') {
            console.log(`\nEnding conversation with "${agent.name}".`);
            
            if (agent.storesMemory) {
              saveConversationToFile(agent);
            } else {
              console.log('This agent does not store memory, no conversation will be saved.');
            }
      
            mainMenu();
            return;
          }
        // Build conversation history
        if (agent.storesMemory && agent.conversationHistory) {
          agent.conversationHistory.push({ role: 'user', content: userMessage });
        } else {
          // If agent doesn't store memory, start fresh
          agent.conversationHistory = [{ role: 'user', content: userMessage }];
        }
  
        // Prepare messages for OpenAI API
        const messages = [
          { role: 'system', content: agent.purpose },
          ...agent.conversationHistory,
        ];
  
        try {
          const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo', 
            messages: messages,
          });
  
          const assistantReply = response.choices[0].message.content;
  
          console.log(`\n${agent.name}: ${assistantReply}\n`);
  
          if (agent.storesMemory) {
            agent.conversationHistory.push({
              role: 'assistant',
              content: assistantReply,
            });
          }
  
          // Continue the conversation
          conversationLoop(agent);
        } catch (error) {
          console.error('Error communicating with OpenAI API:', error);
          mainMenu();
        }
      })
      .catch((error) => {
        console.error('Error:', error);
      });
  }


//save conversations from talking to chat bot to file
  function saveConversationToFile(agent) {
  
    const filePath = `./conversation_history/${agent.name}_conversation_history.json`;
    // Save only if there is conversation history
    if (agent.conversationHistory && agent.conversationHistory.length > 0) {
      fs.writeFile(filePath, JSON.stringify(agent.conversationHistory, null, 2), (err) => {
        if (err) {
          console.error('Error saving conversation:', err);
        } else {
          console.log(`Conversation with "${agent.name}" saved to ${filePath}`);
        }
      });
    } else {
      console.log(`No conversation history to save for agent "${agent.name}".`);
    }
  }
  function loadConversationFromFile(agent) {
    const filePath = `./conversation_history/${agent.name}_conversation_history.json`;
    
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      agent.conversationHistory = JSON.parse(data);
      console.log(`Loaded conversation history for agent "${agent.name}"`);
    } else {
      console.log(`No conversation history found for agent "${agent.name}"`);
    }
  }

  function loadAgents() {
    if (fs.existsSync(path)) {
        const agentsData = fs.readFileSync(path, 'utf-8');
        return JSON.parse(agentsData);
    }
    return [];
}
function saveAgents(agents) {
    fs.writeFileSync(path, JSON.stringify(agents, null, 2));
}


  function deleteAIAgent() {
    const agents = loadAgents();

    if (agents.length === 0) {
        console.log('No agents to delete.');
        return mainMenu();
    }

    inquirer.default.prompt([
        {
            type: 'list',
            name: 'agentToDelete',
            message: 'Select the AI agent you want to delete:',
            choices: agents.map(agent => agent.name),
        },
    ]).then(answers => {
        const agentName = answers.agentToDelete;

        // Filter out the agent to delete
        const updatedAgents = agents.filter(agent => agent.name !== agentName);
        aiAgents = updatedAgents;
        // Save the updated agents list
        saveAgents(updatedAgents);
        const filePath = `./conversation_history/${agentName}_conversation_history.json`;
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log(`Conversation history for "${agentName}" deleted.`);
            } catch (err) {
                console.error('Error deleting conversation history:', err);
            }
        } else {
            console.log(`No conversation history found for "${agentName}".`);
        }

        console.log(`Agent "${agentName}" has been deleted.`);
        mainMenu();
    }).catch(err => console.error(err));
}

  
  // Start the application
  mainMenu();
  