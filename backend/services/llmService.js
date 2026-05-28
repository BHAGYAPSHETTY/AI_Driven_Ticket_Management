require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { sql } = require('../db'); // Import sql object for KB access
const fs = require('fs'); // Import fs for file logging

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL });

// Helper to safely parse JSON from LLM response
function parseLLMJson(responseText) {
    try {
        console.log('parseLLMJson: Raw responseText received:', responseText); // Log raw text
        const jsonMatch = responseText.match(/```json\n(.*)\n```/s);
        if (jsonMatch && jsonMatch[1]) {
             const parsed = JSON.parse(jsonMatch[1]);
             console.log('parseLLMJson: Successfully parsed JSON from code block:', parsed);
             return parsed;
        }
        // Try to parse directly if no code block (LLM sometimes omits it)
        const parsed = JSON.parse(responseText);
        console.log('parseLLMJson: Successfully parsed JSON directly:', parsed);
        return parsed;
    } catch (e) {
        console.error("parseLLMJson: Failed to parse LLM JSON:", responseText, e);
        // Log to file as well
        const logMessage = `[${new Date().toISOString()}] parseLLMJson Error: ${e.message}\nRaw LLM Response: ${responseText}\nStack: ${e.stack || 'No stack'}\n\n`;
        fs.appendFileSync('backend_error.log', logMessage);
        return null; // Return null if parsing fails
    }
}

// A simple retry function with exponential backoff
// Increased maxRetries and initial delay for better resilience against 503s
async function retryOperation(operation, maxRetries = 10, delayMs = 2000) { // Increased retries and initial delay
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            // Check if it's a transient error (e.g., 503 Service Unavailable, 429 Too Many Requests, network errors)
            const isTransient = error.status === 503 || error.status === 429 || (error.message && error.message.includes('fetch failed'));

            if (isTransient && i < maxRetries - 1) {
                console.warn(`Retry attempt ${i + 1}/${maxRetries} for LLM call. Error: ${error.message}. Retrying in ${delayMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                delayMs *= 2; // Exponential backoff
            } else {
                // If max retries reached or it's a non-transient error, re-throw
                console.error(`Max retries reached or non-transient error for LLM call. Error: ${error.message}`);
                throw error;
            }
        }
    }
}

/**
 * AI for Ticket Creation & Categorization (I.1)
 */
async function analyzeTicketRequest(userQuery) {
    const prompt = `
        You are an AI-powered customer support assistant for a ticket management system.
        Your task is to analyze the user's initial query and extract all relevant information to create a ticket.
        Respond ONLY with a JSON object. Ensure all fields are present, using 'null' if information is not directly inferred.

        JSON structure:
        {
            "subject": "Concise, descriptive summary of the issue (max 100 chars)",
            "description": "Detailed problem description based on user input, elaborating if possible.",
            "category": "One of: 'Technical Issue', 'Account Management', 'Billing Inquiry', 'General Question', 'Feature Request', 'Other'",
            "subCategory": "Relevant sub-category (e.g., 'Network', 'Software', 'Hardware', 'Password Reset', 'Login', 'Invoice', 'Payment', 'Refund', 'Product Info', 'System Access', 'New Feature'). Use null if not applicable.",
            "priority": "One of: 'Critical', 'Urgent', 'High', 'Medium', 'Low'. Assign 'Critical' only for system-wide outages, 'Urgent' for individual blockers.",
            "intent": "One of: 'report_bug', 'request_info', 'password_reset', 'account_login', 'billing_query', 'feature_request', 'general_inquiry', 'escalate_issue', 'check_status'",
            "entities": {
                "userID": "Extracted User ID if explicitly mentioned (e.g., 'my ID is 12345'). Use null if not found.",
                "deviceName": "Extracted device name if mentioned (e.g., 'my laptop', 'the server', 'my phone'). Use null.",
                "errorMessage": "Extracted exact error message string if present. Use null.",
                "invoiceNumber": "Extracted invoice number if present. Use null.",
                "serviceAffected": "Specific service mentioned (e.g., 'email', 'VPN', 'website'). Use null."
            }
        }

        Example user queries and desired output:
        User: "My internet is down, nothing works. This is critical!"
        Output:
        {
            "subject": "Internet Connectivity Issue - Critical",
            "description": "User reports complete internet outage, affecting all services. States issue is critical.",
            "category": "Technical Issue",
            "subCategory": "Network",
            "priority": "Critical",
            "intent": "report_bug",
            "entities": {
                "userID": null,
                "deviceName": null,
                "errorMessage": null,
                "invoiceNumber": null,
                "serviceAffected": "internet"
            }
        }

        User: "I can't log into my account. My username is 'johndoe'."
        Output:
        {
            "subject": "Account Login Issue",
            "description": "User 'johndoe' is unable to log into their account.",
            "category": "Account Management",
            "subCategory": "Login",
            "priority": "High",
            "intent": "account_login",
            "entities": {
                "userID": null,
                "deviceName": null,
                "errorMessage": null,
                "invoiceNumber": null,
                "serviceAffected": "account"
            }
        }

        User:"I forgot my password for my email account. Can you help me reset it?"
        Output:
        {
            "subject": "Password Reset Request - Email Account",
            "description": "User requires assistance to reset their password for their email account as they have forgotten it.",
            "category": "Account Management",
            "subCategory": "Password Reset",
            "priority": "High",
            "intent": "password_reset",
            "entities": {
                "userID": null,
                "deviceName": null,
                "errorMessage": null,
                "invoiceNumber": null,
                "serviceAffected": "email"
            }
        }
        User query: "${userQuery}"
        JSON Output:
    `;

    try {
        // Apply retry logic here for generateContent
        const result = await retryOperation(async () => {
            return await model.generateContent(prompt);
        });
        const responseText = result.response.text();
        return parseLLMJson(responseText);
    } catch (error) {
        console.error('Error in analyzeTicketRequest (LLM call):', error);
        const logMessage = `[${new Date().toISOString()}] analyzeTicketRequest Error: ${error.message || error}\nStack: ${error.stack || 'No stack'}\n\n`;
        fs.appendFileSync('backend_error.log', logMessage);
        throw new Error(`LLM Analysis Failed: ${error.message || error}`);
    }
}

/**
 * Knowledge Base Retrieval (RAG - I.2.2)
 */
async function retrieveKnowledgeBaseArticles(query, category = null) {
    try {
        let sqlQuery = `SELECT TOP 3 Title, Content FROM KnowledgeBase WHERE `;
        const queryParts = [];
        const bindings = [];

        queryParts.push(`(Title LIKE '%' + @query + '%' OR Content LIKE '%' + @query + '%' OR Keywords LIKE '%' + @query + '%')`);
        bindings.push({ name: 'query', value: query });

        if (category) {
            queryParts.push(`Category = @category`);
            bindings.push({ name: 'category', value: category });
        }

        sqlQuery += queryParts.join(' AND ');

        const request = new sql.Request();
        bindings.forEach(b => request.input(b.name, b.value));

        const result = await request.query(sqlQuery);
        console.log('retrieveKnowledgeBaseArticles: Retrieved KB articles:', result.recordset.length);
        return result.recordset;
    } catch (err) {
        console.error('Error retrieving knowledge base articles:', err);
        const logMessage = `[${new Date().toISOString()}] retrieveKnowledgeBaseArticles Error: ${err.message || err}\nStack: ${err.stack || 'No stack'}\n\n`;
        fs.appendFileSync('backend_error.log', logMessage);
        throw new Error(`Knowledge Base Retrieval Failed: ${err.message || err}`);
    }
}

/**
 * AI for Generating Solutions / Chatbot Responses (I.2.1, I.2.3, I.2.4)
 */
async function generateChatResponse(userMessage, conversationHistory, relevantKBArticles) {
    const chatHistoryForLLM = conversationHistory.map(entry => ({
        role: entry.senderType === 'user' ? 'user' : 'model',
        parts: [{ text: entry.message }]
    }));

    let kbContext = "";
    if (relevantKBArticles && relevantKBArticles.length > 0) {
        kbContext = "\n\nConsider the following knowledge base articles for your response:\n";
        relevantKBArticles.forEach((article, index) => {
            kbContext += `--- Article ${index + 1}: ${article.Title} ---\n${article.Content}\n\n`;
        });
        kbContext += "Use this information to provide a precise, step-by-step solution or answer.\n";
    }

    // Conditional instruction for conversational responses (including "thank you")
    let specificInstruction = "";
    if (userMessage.toLowerCase().includes("thank you") || userMessage.toLowerCase().includes("thanks")) {
        specificInstruction = "If the user is simply acknowledging or thanking you, provide a brief and polite acknowledgement in return, like 'You're welcome!' or 'Glad I could help!'. Do not generate a long response. Keep it short and to the point.";
    } else {
        specificInstruction = `Based on the user's latest message and the provided context/knowledge, formulate a concise and clear response.
        If providing troubleshooting, list steps clearly. If asking for clarification, be specific.
        If you cannot solve the issue, gently suggest escalating to a human agent.`;
    }

    const prompt = `
        You are an AI-powered customer support chatbot named "SupportBot" for [Your Company Name].
        Your goal is to assist users by providing helpful, empathetic, and efficient solutions.
        Maintain a professional and friendly tone.

        Current conversation history:
        ${chatHistoryForLLM.map(h => `${h.role}: ${h.parts[0].text}`).join('\n')}

        ${kbContext}

        ${specificInstruction}

        User: "${userMessage}"
        SupportBot:
    `;

    try {
        const chat = model.startChat({
            history: chatHistoryForLLM,
            generationConfig: {
                maxOutputTokens: 500, // Limit response length
            },
        });

        // Apply retry logic here for sendMessage
        const result = await retryOperation(async () => {
            return await chat.sendMessage(prompt);
        });

        const responseText = result.response.text();
        console.log('generateChatResponse: AI raw response:', responseText);
        return responseText;
    } catch (error) {
        console.error('Error in generateChatResponse (LLM call):', error);
        const logMessage = `[${new Date().toISOString()}] generateChatResponse Error: ${error.message || error}\nStack: ${error.stack || 'No stack'}\n\n`;
        fs.appendFileSync('backend_error.log', logMessage);
        throw new Error(`Chat Response Generation Failed: ${error.message || error}`);
    }
}

module.exports = {
    analyzeTicketRequest,
    retrieveKnowledgeBaseArticles,
    generateChatResponse
};