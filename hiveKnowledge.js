import OpenAI from 'openai';
import { promises as fs } from 'fs';
import fsRegular from 'fs';
import path from 'path';

const HONEYCOMBS_FILE = 'honeycombs.json';

export default class HiveKnowledge {
    constructor(openai) {
        if (!openai) {
            throw new Error('OpenAI client is required');
        }
        this.openai = openai;
        this.vectorStores = new Map();
    }

    async loadHoneycombs() {
        try {
            const data = await fs.readFile(HONEYCOMBS_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return [];
        }
    }

    async saveHoneycombs(honeycombs) {
        await fs.writeFile(HONEYCOMBS_FILE, JSON.stringify(honeycombs, null, 2));
    }

    async createHoneycomb(name, description, folderPath = null) {
        try {
            let files = [];
            let openAIFiles = [];

            if (folderPath) {
                console.log(`Reading directory: ${folderPath}`);

                const allFiles = await fs.readdir(folderPath);
                files = allFiles.filter(file => file.endsWith('.txt'));
                console.log(`Found ${files.length} .txt files:`, files);

                openAIFiles = await Promise.all(files.map(async file => {
                    const filePath = path.join(folderPath, file);
                    console.log(`Creating OpenAI file for: ${filePath}`);
                    const fileContent = await fs.readFile(filePath);
                    return await this.openai.files.create({
                        file: fileContent,
                        purpose: "assistants"
                    });
                }));

                console.log('Created OpenAI files:', openAIFiles);
            }

            console.log('Creating vector store...');
            const vectorStore = await this.openai.beta.vectorStores.create({
                name: `honeycomb_${name}`,
                file_ids: openAIFiles.map(f => f.id)
            });

            if (openAIFiles.length > 0) {
                console.log('Waiting for files to be processed...');
                await this.openai.beta.vectorStores.fileBatches.createBatch({
                    vector_store_id: vectorStore.id,
                    file_ids: openAIFiles.map(f => f.id)
                });
            }

            const honeycomb = {
                id: vectorStore.id,
                name,
                description,
                created_at: new Date().toISOString(),
                files: files.map((file, index) => ({
                    name: file,
                    path: path.join(folderPath, file),
                    openai_file_id: openAIFiles[index]?.id
                }))
            };

            const honeycombs = await this.loadHoneycombs();
            honeycombs.push(honeycomb);
            await this.saveHoneycombs(honeycombs);

            this.vectorStores.set(name, vectorStore);
            return honeycomb;
        } catch (error) {
            this.handleError(error, 'Error creating honeycomb');
        }
    }

    async addFilesToHoneycomb(honeycombId, folderPath) {
        try {
            const files = await fs.readdir(folderPath);
            const txtFiles = files.filter(file => file.endsWith('.txt'));

            if (txtFiles.length === 0) {
                console.log('No .txt files found in the specified folder.');
                return [];
            }

            // Create array of file streams
            const fileStreams = txtFiles.map(file => ({
                file: fsRegular.createReadStream(path.join(folderPath, file)),
                filename: file
            }));

            console.log(`Uploading ${fileStreams.length} files to vector store...`);

            // Use the uploadAndPoll method
            const response = await this.openai.beta.vectorStores.fileBatches.uploadAndPoll(
                honeycombId,
                fileStreams
            );
            console.log('Upload response:', response);

            // Update honeycombs record
            const honeycombs = await this.loadHoneycombs();
            const honeycomb = honeycombs.find(h => h.id === honeycombId);

            if (honeycomb) {
                honeycomb.files.push(...txtFiles.map(file => ({
                    name: file,
                    path: path.join(folderPath, file)
                })));
                await this.saveHoneycombs(honeycombs);
            }

            return response;
        } catch (error) {
            console.error('Full error object:', error);
            if (error.response) {
                console.error('Response data:', error.response.data);
            }
            this.handleError(error, 'Error adding files to honeycomb');
        }
    }

    async deleteHoneycomb(honeycombId) {
        try {
            await this.openai.beta.vectorStores.del(honeycombId);
            this.vectorStores.delete(honeycombId);

            const honeycombs = await this.loadHoneycombs();
            const updatedHoneycombs = honeycombs.filter(h => h.id !== honeycombId);
            await this.saveHoneycombs(updatedHoneycombs);
        } catch (error) {
            this.handleError(error, 'Error deleting honeycomb');
        }
    }

    handleError(error, context) {
        console.error(`${context}:`, error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        throw new Error(`${context}: ${error.message}`);
    }
} 