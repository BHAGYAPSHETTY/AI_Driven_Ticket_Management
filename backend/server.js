require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB, sql } = require('./db');
const fs = require('fs');
const { analyzeTicketRequest, retrieveKnowledgeBaseArticles, generateChatResponse } = require('./services/llmService'); // Ensure these are correctly imported

// --- GLOBAL ERROR HANDLERS ---
// These capture errors that are NOT caught by specific try...catch blocks.
// In a production environment, you typically want to log these and keep the process alive
// unless it's an unrecoverable state. For development, exiting can help spot issues.
// For robust production, consider a process manager like PM2 that restarts the app.
process.on('unhandledRejection', (reason, promise) => {
    const timestamp = new Date().toISOString();
    const logMessage = `\n\n--- GLOBAL UNHANDLED PROMISE REJECTION ---\n`;
    const errorDetails = `Timestamp: ${timestamp}\nPromise: ${promise}\nReason: ${reason}\nReason Stack: ${reason && reason.stack ? reason.stack : 'No stack'}\n\n`;

    console.error(logMessage);
    console.error(errorDetails);
    fs.appendFileSync('backend_error.log', logMessage + errorDetails);
    // In production, avoid process.exit(1) here unless absolutely necessary.
    // For development, it helps in quickly identifying unhandled issues.
    // process.exit(1);
});

process.on('uncaughtException', (err) => {
    const timestamp = new Date().toISOString();
    const logMessage = `\n\n--- GLOBAL UNCAUGHT EXCEPTION ---\n`;
    const errorDetails = `Timestamp: ${timestamp}\nError: ${err.message}\nError Stack: ${err.stack}\n\n`;

    console.error(logMessage);
    console.error(errorDetails);
    fs.appendFileSync('backend_error.log', logMessage + errorDetails);
    // In production, avoid process.exit(1) here unless absolutely necessary.
    // For development, it helps in quickly identifying unhandled issues.
    // process.exit(1);
});
// --- END GLOBAL ERROR HANDLERS ---

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

connectDB(); // Establish database connection

// --- API Routes ---

// 1. Test Route
app.get('/', (req, res) => {
    res.send('Ticket Management API is running!');
});

// 2. Get all tickets
app.get('/api/tickets', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM Tickets ORDER BY CreatedAt DESC`;
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching tickets:', err);
        const logMessage = `[${new Date().toISOString()}] Error fetching tickets: ${err.message}\nStack: ${err.stack}\n`;
        fs.appendFileSync('backend_error.log', logMessage);
        res.status(500).json({ message: 'Error fetching tickets', error: err.message });
    }
});

// 3. Create Ticket with AI Analysis and Initial Response
app.post('/api/tickets', async (req, res) => {
    console.log('********** POST /api/tickets endpoint HIT! **********');
    console.log('--- START TICKET CREATION PROCESS ---');
    console.log('Received request body:', req.body);
    const { userQuery, userID } = req.body;
    console.log('Extracted User Query:', userQuery, 'UserID:', userID);

    console.log('DEBUG CHECKPOINT 1: Request successfully processed by Express.');

    let aiAnalysis;
    try {
        console.log('Attempting to call analyzeTicketRequest (LLM service)...');
        aiAnalysis = await analyzeTicketRequest(userQuery); // llmService.js handles retries internally
        console.log('analyzeTicketRequest completed. Result:', aiAnalysis);
        console.log('DEBUG: aiAnalysis structure before SQL:', JSON.stringify(aiAnalysis, null, 2));

        console.log('DEBUG CHECKPOINT 2: LLM analysis completed, checking aiAnalysis content.');

        if (!aiAnalysis) {
            const errMsg = 'AI failed to analyze ticket request. Check LLM response parsing or LLM API key/model. analyzeTicketRequest returned null.';
            console.error('ERROR:', errMsg);
            fs.appendFileSync('backend_error.log', `[${new Date().toISOString()}] ERROR: ${errMsg}\n`);
            return res.status(500).json({ message: errMsg });
        }

        console.log('AI Analysis valid. Proceeding with SQL INSERT for Tickets...');
        console.log('DEBUG CHECKPOINT 3: Attempting SQL INSERT for Tickets table.');

        const result = await sql.query`
            INSERT INTO Tickets (UserID, Subject, Description, Category, SubCategory, Priority, Status, Intent)
            VALUES (
                ${userID},
                ${aiAnalysis.subject || userQuery.substring(0, 100)},
                ${aiAnalysis.description || userQuery},
                ${aiAnalysis.category || 'Uncategorized'},
                ${aiAnalysis.subCategory},
                ${aiAnalysis.priority || 'Medium'},
                'Open',
                ${aiAnalysis.intent || 'general_inquiry'}
            );
            SELECT SCOPE_IDENTITY() AS TicketID;
        `;
        const ticketID = result.recordset[0].TicketID;
        console.log('Ticket inserted successfully. New TicketID:', ticketID);

        console.log('DEBUG CHECKPOINT 4: Ticket inserted, proceeding to conversation.');

        console.log('Inserting initial user message into Conversations...');
        await sql.query`
            INSERT INTO Conversations (TicketID, SenderType, Message)
            VALUES (${ticketID}, 'user', ${userQuery});
        `;
        console.log('User message saved to Conversations.');

        let initialAIResponse = "Your ticket has been created. We are looking into your request and will get back to you shortly."; // Default fallback message

        // Attempt to generate initial AI response based on intent
        if (aiAnalysis.intent === 'password_reset' || aiAnalysis.intent === 'account_login' || aiAnalysis.intent === 'request_info') {
            console.log('Intent matched for immediate solution. Attempting KB retrieval and solution generation...');
            let kbArticles = [];
            try {
                kbArticles = await retrieveKnowledgeBaseArticles(userQuery, aiAnalysis.category);
                console.log(`Retrieved ${kbArticles.length} KB articles.`);
            } catch (kbErr) {
                console.warn('Warning: Failed to retrieve KB articles for initial response.', kbErr.message);
                // Continue without KB articles if retrieval fails
            }
            
            const chatHistoryForSolution = [{ senderType: 'user', message: userQuery }]; // Only the current user query for initial context
            
            try {
                const generatedResponse = await generateChatResponse(userQuery, chatHistoryForSolution, kbArticles); // llmService.js handles retries internally
                // If the generated response is very generic or an apology, use a more helpful fallback
                if (generatedResponse && !generatedResponse.includes("I apologize") && !generatedResponse.includes("I'm sorry")) {
                    initialAIResponse = generatedResponse;
                } else {
                    console.warn("LLM generated a generic/apology response for initial query. Using fallback.");
                }
                console.log('Generated initial AI response:', initialAIResponse);
            } catch (chatError) {
                console.error('Error generating initial AI response (after retries):', chatError.message);
                const chatLogError = `[${new Date().toISOString()}] Initial AI Response Generation Failed: ${chatError.message}\nStack: ${chatError.stack}\n\n`;
                fs.appendFileSync('backend_error.log', chatLogError);
                // Keep the default fallback message if AI generation completely fails
                initialAIResponse = "Your ticket has been created. I'm having trouble generating an immediate solution right now, but our team will review your request as soon as possible.";
            }
        }

        console.log('Inserting initial AI response into Conversations...');
        await sql.query`
            INSERT INTO Conversations (TicketID, SenderType, Message)
            VALUES (${ticketID}, 'ai', ${initialAIResponse});
        `;
        console.log('AI response saved to Conversations.');

        res.status(201).json({
            message: 'Ticket created successfully with AI analysis',
            ticketID: ticketID,
            aiAnalysis: aiAnalysis,
            initialAIResponse: initialAIResponse // Send the response to the frontend
        });
        console.log('--- END TICKET CREATION PROCESS: SUCCESS ---');

    } catch (err) {
        // --- CATCH BLOCK FOR TICKET CREATION ROUTE ---
        const timestamp = new Date().toISOString();
        const logMessage = `\n\n--- CRITICAL ERROR IN TICKET CREATION PROCESS ---\n`;
        const errorDetails = `Timestamp: ${timestamp}\nError Name: ${err.name}\nError Message: ${err.message}\nError Stack:\n${err.stack}\n--- END TICKET CREATION PROCESS: ERROR ---\n\n`;

        console.error(logMessage);
        console.error(errorDetails);
        fs.appendFileSync('backend_error.log', logMessage + errorDetails);

        if (!res.headersSent) { // Check if headers have already been sent to prevent "Cannot set headers after they are sent to the client" error
            res.status(500).json({
                message: 'Internal Server Error during ticket creation',
                error: err.message,
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined // Only expose stack in development
            });
        }
        // IMPORTANT: Removed process.exit(1) from here to keep the server running.
    }
});

// 4. Get Conversation History for a Ticket
app.get('/api/tickets/:ticketId/conversations', async (req, res) => {
    const { ticketId } = req.params;
    try {
        const result = await sql.query`
            SELECT SenderType, Message, Timestamp
            FROM Conversations
            WHERE TicketID = ${ticketId}
            ORDER BY Timestamp ASC;
        `;
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching conversation history:', err);
        const logMessage = `[${new Date().toISOString()}] Error fetching conversation history for TicketID ${ticketId}: ${err.message}\nStack: ${err.stack}\n`;
        fs.appendFileSync('backend_error.log', logMessage);
        res.status(500).json({ message: 'Error fetching conversation history', error: err.message });
    }
});

// 5. Chatbot Interaction Endpoint
app.post('/api/tickets/:ticketId/chat', async (req, res) => {
    const { ticketId } = req.params;
    const { userMessage } = req.body;
    const userID = req.body.userID || 1; // Assuming for now, get from auth later

    if (!userMessage) {
        return res.status(400).json({ message: 'Missing user message' });
    }

    try {
        // First, save the user's message
        await sql.query`
            INSERT INTO Conversations (TicketID, SenderType, Message)
            VALUES (${ticketId}, 'user', ${userMessage});
        `;
        console.log(`User message for Ticket ${ticketId} saved.`);

        // Fetch current ticket details and full conversation history for context
        const ticketResult = await sql.query`SELECT * FROM Tickets WHERE TicketID = ${ticketId}`;
        const ticket = ticketResult.recordset[0];

        if (!ticket) {
            return res.status(404).json({ message: 'Ticket not found.' });
        }

        const conversationHistoryResult = await sql.query`
            SELECT SenderType, Message
            FROM Conversations
            WHERE TicketID = ${ticketId}
            ORDER BY Timestamp ASC;
        `;
        const conversationHistory = conversationHistoryResult.recordset;
        console.log(`Fetched conversation history for Ticket ${ticketId}. Messages: ${conversationHistory.length}`);

        // Attempt to retrieve relevant KB articles based on the *latest* user message
        let relevantKBArticles = [];
        try {
            relevantKBArticles = await retrieveKnowledgeBaseArticles(userMessage, ticket.Category);
            console.log(`Retrieved ${relevantKBArticles.length} KB articles for chat response.`);
        } catch (kbErr) {
            console.warn(`Warning: Failed to retrieve KB articles during chat for Ticket ${ticketId}: ${kbErr.message}`);
            // Continue without KB articles if retrieval fails
        }
        
        // Generate AI response
        let aiResponse = "I apologize, I'm having trouble understanding or responding right now. Please try again later or contact a human agent."; // Default fallback for chat
        try {
            const generatedAiResponse = await generateChatResponse(userMessage, conversationHistory, relevantKBArticles); // llmService.js handles retries internally
            if (generatedAiResponse && !generatedAiResponse.includes("I apologize") && !generatedAiResponse.includes("I'm sorry")) {
                 aiResponse = generatedAiResponse;
            } else {
                console.warn("LLM generated a generic/apology response during chat. Using fallback.");
            }
            console.log('Generated AI response for chat:', aiResponse);
        } catch (chatError) {
            console.error('Error generating AI response for chat (after retries):', chatError.message);
            const chatLogError = `[${new Date().toISOString()}] Chat AI Response Generation Failed for Ticket ${ticketId}: ${chatError.message}\nStack: ${chatError.stack}\n\n`;
            fs.appendFileSync('backend_error.log', chatLogError);
            // aiResponse remains the default fallback message
        }

        // Save AI's response
        await sql.query`
            INSERT INTO Conversations (TicketID, SenderType, Message)
            VALUES (${ticketId}, 'ai', ${aiResponse});
        `;
        console.log(`AI response for Ticket ${ticketId} saved.`);

        res.status(200).json({
            userMessage: userMessage,
            aiResponse: aiResponse,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('Error in chatbot interaction:', err);
        const logMessage = `[${new Date().toISOString()}] Error in chatbot interaction for TicketID ${ticketId}: ${err.message}\nStack: ${err.stack}\n`;
        fs.appendFileSync('backend_error.log', logMessage);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Error processing chat message', error: err.message });
        }
    }
});

// --- Catch-all for unhandled routes (404) ---
app.use((req, res, next) => {
    console.error(`404 Not Found: ${req.method} ${req.originalUrl}`);
    fs.appendFileSync('backend_error.log', `[${new Date().toISOString()}] 404 Not Found: ${req.method} ${req.originalUrl}\n`);
    res.status(404).json({ message: 'API endpoint not found.' });
});

// --- Generic error handler (must have 4 arguments: err, req, res, next) ---
app.use((err, req, res, next) => {
    const timestamp = new Date().toISOString();
    const logMessage = `\n\n--- GENERAL EXPRESS ERROR HANDLER ---\n`;
    const errorDetails = `Timestamp: ${timestamp}\nRequest: ${req.method} ${req.originalUrl}\nError Name: ${err.name}\nError Message: ${err.message}\nError Stack:\n${err.stack}\n--- END GENERAL EXPRESS ERROR ---\n\n`;

    console.error(logMessage);
    console.error(errorDetails);
    fs.appendFileSync('backend_error.log', logMessage + errorDetails);

    if (!res.headersSent) {
        res.status(err.status || 500).json({
            message: 'Internal Server Error',
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined // Only expose stack in development
        });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log(`Database connection status: ${sql ? 'Connected' : 'Not Connected'}`);
});