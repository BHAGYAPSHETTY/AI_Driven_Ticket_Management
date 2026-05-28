Create database TicketDB1;
use TicketDB1;

CREATE TABLE Users (
    UserID INT PRIMARY KEY IDENTITY(1,1),
    Username NVARCHAR(50) UNIQUE NOT NULL,
    PasswordHash NVARCHAR(255) NOT NULL, -- Store hashed passwords!
    Email NVARCHAR(100) UNIQUE NOT NULL,
    UserRole NVARCHAR(20) DEFAULT 'user' -- 'user', 'agent', 'manager'
);

CREATE TABLE Tickets (
    TicketID INT PRIMARY KEY IDENTITY(1,1),
    UserID INT NOT NULL, -- Who created the ticket
    Subject NVARCHAR(255) NOT NULL,
    Description NVARCHAR(MAX) NOT NULL,
    Category NVARCHAR(50),
    SubCategory NVARCHAR(50),
    Priority NVARCHAR(20),
    Status NVARCHAR(20) DEFAULT 'Open', -- 'Open', 'In Progress', 'Resolved', 'Closed', 'Escalated'
    CreatedAt DATETIME DEFAULT GETDATE(),
    UpdatedAt DATETIME DEFAULT GETDATE(),
    AssignedToAgentID INT NULL, -- Agent who took the ticket
    ResolutionDetails NVARCHAR(MAX),
    FOREIGN KEY (UserID) REFERENCES Users(UserID),
    FOREIGN KEY (AssignedToAgentID) REFERENCES Users(UserID) -- Assuming agents are also users
);

CREATE TABLE Conversations (
    ConversationID INT PRIMARY KEY IDENTITY(1,1),
    TicketID INT NOT NULL,
    SenderType NVARCHAR(10) NOT NULL, -- 'user', 'ai', 'agent'
    Message NVARCHAR(MAX) NOT NULL,
    Timestamp DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (TicketID) REFERENCES Tickets(TicketID)
);

CREATE TABLE KnowledgeBase (
    ArticleID INT PRIMARY KEY IDENTITY(1,1),
    Title NVARCHAR(255) NOT NULL,
    Content NVARCHAR(MAX) NOT NULL,
    Category NVARCHAR(50),
    Keywords NVARCHAR(MAX),
    CreatedAt DATETIME DEFAULT GETDATE(),
    UpdatedAt DATETIME DEFAULT GETDATE()
);

-- Add a sample user (IMPORTANT: Hash passwords in real apps!)
INSERT INTO Users (Username, PasswordHash, Email, UserRole)
VALUES ('testuser', 'password123', 'user@example.com', 'user'); -- Replace 'password123' with a real hash for production!

INSERT INTO Users (Username, PasswordHash, Email, UserRole)
VALUES ('agent1', 'password123', 'agent1@example.com', 'agent');

ALTER TABLE Tickets
ADD Intent NVARCHAR(50) NULL;

INSERT INTO KnowledgeBase (Title, Content, Category, Keywords) VALUES
('How to Reset Your Password', 'To reset your password, visit our login page, click "Forgot Password," and follow the prompts to enter your email. A reset link will be sent to your registered email address. Check your spam folder if you don''t receive it.', 'Account Management', 'password, reset, forgot, login'),
('Troubleshooting Wi-Fi Connectivity', '1. Restart your router. 2. Restart your device. 3. Check network cables. 4. Ensure Wi-Fi is enabled on your device. 5. Try connecting to another network. 6. Update network drivers.', 'Technical Issue', 'wifi, network, connectivity, internet, troubleshoot'),
('Understanding Your Latest Invoice', 'Your invoice details your charges for the billing period. Line items include monthly subscriptions, usage-based fees, and any one-time charges. Payments are due by the date specified at the top of the invoice. For discrepancies, please contact billing support.', 'Billing Inquiry', 'invoice, bill, payment, charges, breakdown'),
('How to Clear Browser Cache', 'To clear your browser cache: In Chrome, go to Settings > Privacy and security > Clear Browse data. In Firefox, go to Settings > Privacy & Security > Cookies and Site Data > Clear Data. In Edge, go to Settings > Privacy, search, and services > Choose what to clear. Select "Cached images and files" and clear.', 'Technical Issue', 'cache, browser, clear, troubleshooting, website, performance');
SELECT * FROM KnowledgeBase;

SELECT * FROM Tickets;