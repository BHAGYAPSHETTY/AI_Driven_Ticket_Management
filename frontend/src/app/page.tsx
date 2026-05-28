'use client';

import { useState, useEffect } from 'react';

interface Ticket {
  TicketID: number;
  Subject: string;
  Description: string;
  Status: string;
  InitialAIResponse?: string; // Add this field
}

interface ConversationMessage {
  SenderType: 'user' | 'ai' | 'agent';
  Message: string;
  Timestamp: string;
}

export default function Home() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [activeTicketId, setActiveTicketId] = useState<number | null>(null);
  const [activeTicketSubject, setActiveTicketSubject] = useState<string>('');
  const [chatInput, setChatInput] = useState<string>('');
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

  useEffect(() => {
    fetchTickets();
  }, []);

  useEffect(() => {
    if (activeTicketId) {
      fetchConversationHistory(activeTicketId);
    } else {
      setConversationHistory([]); // Clear history if no ticket is active
    }
  }, [activeTicketId]);

  const fetchTickets = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/tickets`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setTickets(data);
    } catch (error) {
      console.error('Error fetching tickets:', error);
      setMessage('Failed to fetch tickets.');
    }
  };

  const fetchConversationHistory = async (ticketId: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/tickets/${ticketId}/conversations`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setConversationHistory(data);
    } catch (error) {
      console.error('Error fetching conversation history:', error);
      setMessage('Failed to load conversation history.');
    }
  };

  const createTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setIsLoading(true);
    try {
      const userID = 1; // Hardcoded for now
      const userQuery = chatInput; // Use the chat input for initial ticket description

      const response = await fetch(`${API_BASE_URL}/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userID: userID,
          userQuery: userQuery,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setMessage(`Ticket created successfully with ID: ${data.ticketID}`);
      setChatInput(''); // Clear input
      fetchTickets(); // Refresh ticket list
      setActiveTicketId(data.ticketID); // Set as active ticket
      setActiveTicketSubject(data.aiAnalysis.subject || 'New Ticket');
      // The initialAIResponse is returned and will be fetched with history on activeTicketId change
    } catch (error: any) {
      console.error('Error creating ticket:', error);
      setMessage(`Failed to create ticket: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicketId || !chatInput.trim()) return;

    const currentUserMessage: ConversationMessage = {
      SenderType: 'user',
      Message: chatInput,
      Timestamp: new Date().toISOString(),
    };
    // Optimistically update UI with user's message
    setConversationHistory((prev) => [...prev, currentUserMessage]);
    setChatInput('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/tickets/${activeTicketId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userMessage: currentUserMessage.Message, userID: 1 }), // userID for logging/context
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      // AI response will be fetched when history is refetched
      await fetchConversationHistory(activeTicketId);

    } catch (error: any) {
      console.error('Error sending message:', error);
      setMessage(`Failed to send message: ${error.message}`);
      // Revert optimistic update or add error message to conversation
      setConversationHistory((prev) => prev.filter(msg => msg !== currentUserMessage));
    } finally {
      setIsLoading(false);
    }
  };

  const handleTicketClick = (ticket: Ticket) => {
    setActiveTicketId(ticket.TicketID);
    setActiveTicketSubject(ticket.Subject);
  };

  return (
    <main className="flex min-h-screen">
      {/* Left Pane: Ticket List */}
      <div className="w-1/4 bg-gray-100 p-6 border-r border-gray-200 overflow-y-auto">
        <h2 className="text-2xl font-bold mb-6">Your Tickets</h2>
        <button
          onClick={() => { setActiveTicketId(null); setChatInput(''); setActiveTicketSubject(''); setMessage(''); }}
          className="mb-4 w-full bg-green-500 text-white py-2 px-4 rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        >
          Create New Ticket
        </button>

        {tickets.length === 0 && !isLoading ? (
          <p className="text-gray-600">No tickets found.</p>
        ) : (
          <ul className="space-y-3">
            {tickets.map((ticket) => (
              <li
                key={ticket.TicketID}
                onClick={() => handleTicketClick(ticket)}
                className={`p-3 border rounded-lg shadow-sm cursor-pointer transition-all duration-200
                  ${activeTicketId === ticket.TicketID ? 'bg-blue-100 border-blue-400' : 'bg-white hover:bg-gray-50'}`}
              >
                <h3 className="font-medium truncate">{ticket.Subject}</h3>
                <p className="text-sm text-gray-500">Status: {ticket.Status}</p>
                <p className="text-xs text-gray-400">ID: {ticket.TicketID}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right Pane: Chatbot/Ticket Detail */}
      <div className="w-3/4 p-6 flex flex-col">
        {activeTicketId === null ? (
          <div className="flex-grow flex flex-col justify-center items-center bg-white rounded-lg shadow-md p-8">
            <h1 className="text-3xl font-bold mb-4">Start a New Conversation</h1>
            <p className="text-gray-600 mb-6">Describe your issue in natural language below to create a new ticket, or select an existing one from the left pane.</p>
            <form onSubmit={createTicket} className="w-full max-w-lg">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                rows={6}
                className="w-full p-4 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-lg"
                placeholder="e.g., My internet is not working on my laptop. I need help resetting my password. I have a question about my latest invoice."
                required
                disabled={isLoading}
              ></textarea>
              <button
                type="submit"
                className="mt-4 w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                disabled={isLoading || !chatInput.trim()}
              >
                {isLoading ? 'Creating Ticket...' : 'Create Ticket'}
              </button>
              {message && <p className="mt-4 text-center text-sm text-green-600">{message}</p>}
            </form>
          </div>
        ) : (
          <div className="flex flex-col flex-grow bg-white rounded-lg shadow-md">
            <div className="p-4 border-b border-gray-200 bg-blue-50 rounded-t-lg">
              <h2 className="text-xl font-bold text-blue-800">Ticket #{activeTicketId}: {activeTicketSubject}</h2>
              <p className="text-sm text-gray-600">Status: {tickets.find(t => t.TicketID === activeTicketId)?.Status}</p>
            </div>

            {/* Conversation Area */}
            <div className="flex-grow p-4 overflow-y-auto space-y-4">
              {conversationHistory.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${msg.SenderType === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] p-3 rounded-lg shadow-md ${
                      msg.SenderType === 'user'
                        ? 'bg-blue-500 text-white rounded-br-none'
                        : 'bg-gray-200 text-gray-800 rounded-bl-none'
                    }`}
                  >
                    <p className="font-semibold text-sm mb-1">{msg.SenderType === 'ai' ? 'SupportBot' : (msg.SenderType === 'user' ? 'You' : 'Agent')}</p>
                    <p>{msg.Message}</p>
                    <p className="text-xs mt-1 opacity-75">{new Date(msg.Timestamp).toLocaleTimeString()}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="max-w-[70%] p-3 rounded-lg shadow-md bg-gray-200 text-gray-800 rounded-bl-none">
                    <p className="font-semibold text-sm mb-1">SupportBot</p>
                    <p className="animate-pulse">Typing...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div className="p-4 border-t border-gray-200 bg-white rounded-b-lg">
              <form onSubmit={sendChatMessage} className="flex space-x-3">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  rows={2}
                  className="flex-grow p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-blue-500 focus:border-blue-500 resize-none"
                  placeholder="Type your message..."
                  required
                  disabled={isLoading}
                ></textarea>
                <button
                  type="submit"
                  className="bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
                  disabled={isLoading || !chatInput.trim()}
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}