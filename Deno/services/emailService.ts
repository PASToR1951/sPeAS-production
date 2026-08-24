/**
 * Email Service
 * Handles sending emails, including those with attachments
 */

import nodemailer from "nodemailer";
import { ensureDir } from "https://deno.land/std@0.190.0/fs/ensure_dir.ts";
import { join } from "../deps.ts";
import { FileCheckService } from './fileCheckService.ts';
import { encode as encodeBase64 } from "https://deno.land/std@0.190.0/encoding/base64.ts";
import { escapeContactHtml } from "../shared/contactInquiry.ts";

// Load .env from the Deno project root (path pinned to this module so it
// works regardless of the process working directory). Idempotent with the
// load in config/db.ts.
try {
  const { dotenvConfig } = await import("../deps.ts");
  const { fromFileUrl } = await import("https://deno.land/std@0.200.0/path/from_file_url.ts");
  await dotenvConfig({
    envPath: fromFileUrl(new URL("../.env", import.meta.url)),
    export: true,
  });
} catch (_error) {
  // Missing .env is tolerated; SMTP config falls back to Deno.env/shell vars.
}
// Email configuration. Credentials must come from environment variables.
function secretFromEnvironment(name: string): string {
  const direct = Deno.env.get(name);
  if (direct) return direct;
  const filePath = Deno.env.get(`${name}_FILE`);
  if (!filePath) return "";
  try {
    return Deno.readTextFileSync(filePath).trim();
  } catch {
    return "";
  }
}

const EMAIL_CONFIG = {
  hostname: Deno.env.get("SMTP_HOST") || "smtp.gmail.com",
  port: parseInt(Deno.env.get("SMTP_PORT") || "465"),
  username: secretFromEnvironment("SMTP_USERNAME"),
  password: secretFromEnvironment("SMTP_PASSWORD"),
  useTLS: Deno.env.get("SMTP_TLS") !== "false", // true = implicit TLS; false = STARTTLS
  connectTimeout: 30000, // 30 seconds timeout for connection
  sendTimeout: 60000,    // 60 seconds timeout for sending operations
};

// Fix for from address format
const getFormattedFromAddress = () => {
  const username = EMAIL_CONFIG.username;
  // Ensure username is a valid email address
  if (!username || !username.includes('@')) {
    // Return a placeholder that's properly formatted but will fail auth
    return 'noreply@example.com';
  }
  
  // Ensure the from address follows RFC 5322 format
  if (username.includes('<') && username.includes('>')) {
    // Already properly formatted
    return username;
  } else {
    // Use a properly formatted RFC 5322 address with name and email
    return `"sPeAS System" <${username}>`;
  }
};

// Validate email configuration on initialization
(() => {
  const problems = [];
  
  if (!EMAIL_CONFIG.username) problems.push("SMTP_USERNAME environment variable is not set");
  if (!EMAIL_CONFIG.password) problems.push("SMTP_PASSWORD environment variable is not set");
  if (!EMAIL_CONFIG.username?.includes('@')) problems.push("SMTP_USERNAME is not a valid email address (must include @)");
  
  if (problems.length > 0) {
    problems.forEach(problem => console.error(`  - ${problem}`));
  }
})();

// Log current email configuration (with password masked)

// Log a warning if credentials are missing
if (!EMAIL_CONFIG.username || !EMAIL_CONFIG.password) {
}

type SmtpMessage = {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: unknown[];
  headers?: Record<string, string>;
};

// Nodemailer opens a fresh SMTP connection for each message unless pooling is
// enabled. That avoids retaining a stale socket between unrelated requests.
let smtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

// Add file existence verification and debug mode to the email service
const DEBUG_MODE = true; // Enable more verbose debugging

/**
 * Initializes the SMTP client with the provided configuration
 */
function initializeClient() {
  if (!EMAIL_CONFIG.username || !EMAIL_CONFIG.password) return null;

  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: EMAIL_CONFIG.hostname,
      port: EMAIL_CONFIG.port,
      secure: EMAIL_CONFIG.useTLS,
      // SMTP_TLS=false means the connection must be upgraded with STARTTLS;
      // credentials must never fall back to an unencrypted connection.
      requireTLS: !EMAIL_CONFIG.useTLS,
      auth: {
        user: EMAIL_CONFIG.username,
        pass: EMAIL_CONFIG.password,
      },
      connectionTimeout: EMAIL_CONFIG.connectTimeout,
      greetingTimeout: EMAIL_CONFIG.connectTimeout,
      socketTimeout: EMAIL_CONFIG.sendTimeout,
      tls: { minVersion: "TLSv1.2" },
    });
  }

  return smtpTransport;
}

async function sendSmtpMessage(
  message: SmtpMessage,
): Promise<void> {
  const client = initializeClient();
  if (!client) {
    throw new Error("Failed to initialize SMTP client. Check your email settings.");
  }

  try {
    await client.sendMail(message);
  } catch (error) {
    smtpTransport = null;
    client.close();
    throw error;
  }
}

/** Sends one privacy-preserving newsletter message to exactly one recipient. */
export async function sendNewsletterMessage(input: {
  recipient: string;
  subject: string;
  text: string;
  html: string;
  manageUrl?: string;
  unsubscribeUrl?: string;
  oneClickUrl?: string;
}): Promise<void> {
  const username = EMAIL_CONFIG.username;
  const from = username.includes("<")
    ? username.replace(/^\s*"?[^"]*"?\s*</, '"PeAS Repository Updates" <')
    : `"PeAS Repository Updates" <${username}>`;
  await sendSmtpMessage({
    from,
    to: input.recipient,
    replyTo: Deno.env.get("OFFICE_REPLY_TO_EMAIL") || Deno.env.get("CONTACT_RECIPIENT_EMAIL") || undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
    headers: input.oneClickUrl && input.unsubscribeUrl ? {
      "List-Unsubscribe": `<${input.oneClickUrl}>, <${input.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    } : undefined,
  });
}

export async function sendContactInquiryEmail(input: {
  recipient: string;
  referenceCode: string;
  visitorEmail: string;
  visitorName: string;
  subject: string;
  message: string;
}): Promise<void> {
  const emailSubject = `[PeAS Contact][${input.referenceCode}] ${input.subject}`;
  const text = [
    `Reference: ${input.referenceCode}`,
    `From: ${input.visitorName} <${input.visitorEmail}>`,
    `Subject: ${input.subject}`,
    "",
    input.message,
  ].join("\n");
  const html = `
    <h1>PeAS Contact Inquiry</h1>
    <p><strong>Reference:</strong> ${escapeContactHtml(input.referenceCode)}</p>
    <p><strong>From:</strong> ${escapeContactHtml(input.visitorName)} &lt;${escapeContactHtml(input.visitorEmail)}&gt;</p>
    <p><strong>Subject:</strong> ${escapeContactHtml(input.subject)}</p>
    <hr>
    <p>${escapeContactHtml(input.message).replaceAll("\n", "<br>")}</p>
  `;

  await sendSmtpMessage({
    from: getFormattedFromAddress(),
    to: input.recipient,
    replyTo: input.visitorEmail,
    subject: emailSubject,
    text,
    html,
  });
}

export async function sendPasswordResetEmail(input: {
  recipient: string;
  administratorName?: string | null;
  resetUrl: string;
}): Promise<void> {
  const administratorName = input.administratorName?.trim() || "Administrator";
  const text = [
    `Hi ${administratorName},`,
    "",
    "A password reset was requested for your PeAS administrator account.",
    "Use the secure link below to choose a new password. This single-use link expires in one hour.",
    "",
    input.resetUrl,
    "",
    "If you did not request this reset, you can ignore this email. Your password will remain unchanged.",
  ].join("\n");
  const html = `
    <h1>Reset your PeAS password</h1>
    <p>Hi ${escapeContactHtml(administratorName)},</p>
    <p>A password reset was requested for your PeAS administrator account.</p>
    <p>Use the secure link below to choose a new password. This single-use link expires in one hour.</p>
    <p><a href="${escapeContactHtml(input.resetUrl)}">Reset password</a></p>
    <p>If you did not request this reset, you can ignore this email. Your password will remain unchanged.</p>
  `;

  const result = await sendEmailWithAttachment(
    input.recipient,
    "Reset your PeAS administrator password",
    text,
    html,
  );
  if (!result?.success) {
    throw new Error("Password reset email could not be delivered");
  }
  await logEmailActivity("PASSWORD_RESET_EMAIL_SENT", {
    recipient: input.recipient,
    subject: "Reset your PeAS administrator password",
  });
}

/**
 * Logs email activity to a file for tracking purposes
 * @param action The action being performed
 * @param details Details about the email
 */
async function logEmailActivity(action: string, details: Record<string, any>): Promise<void> {
  try {
    // Ensure logs directory exists
    await ensureDir("./logs");

    const now = new Date();
    const timestamp = now.toISOString();
    const date = now.toISOString().split('T')[0]; // YYYY-MM-DD format
    
    // Create a log entry
    const logEntry = {
      timestamp,
      action,
      ...details
    };
    
    // Format log message
    const logMessage = JSON.stringify(logEntry) + "\n";
    
    // Append to daily log file
    const logFile = `./logs/email-activity-${date}.log`;
    
    await Deno.writeTextFile(logFile, logMessage, { append: true })
      .catch(async (err) => {
        // If file doesn't exist, create it
        if (err instanceof Deno.errors.NotFound) {
          await Deno.writeTextFile(logFile, logMessage);
        } else {
          throw err;
        }
      });
      
      } catch (error) {
    // Don't fail the main operation if logging fails
  }
}

// Add a new function to detect file types
/**
 * Detects the MIME type of a file based on its header bytes
 * @param filePath Path to the file
 * @returns Promise resolving to the MIME type string
 */
async function getFileType(filePath: string): Promise<string> {
  try {
    // Read first 4 bytes of file to determine type
    const file = await Deno.open(filePath, { read: true });
    const buffer = new Uint8Array(4);
    await file.read(buffer);
    file.close();
    
    // Check for PDF signature: %PDF (25 50 44 46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return "application/pdf";
    }
    
    // Check for common document formats
    // Office formats often start with PK (zip files)
    if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
      if (filePath.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (filePath.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      if (filePath.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    }
    
    // Default to checking file extension
    if (filePath.toLowerCase().endsWith(".pdf")) return "application/pdf";
    if (filePath.toLowerCase().endsWith(".doc")) return "application/msword";
    if (filePath.toLowerCase().endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (filePath.toLowerCase().endsWith(".txt")) return "text/plain";
    
    return "application/octet-stream"; // Default binary type
  } catch (error) {
    // If we can't detect the type but the file has a .pdf extension, assume it's a PDF
    if (filePath.toLowerCase().endsWith(".pdf")) {
      return "application/pdf";
    }
    return "application/octet-stream";
  }
}

// Fix the encoding function to properly handle binary data in Deno
async function encodeFileForEmail(filePath: string): Promise<{
  content: string;
  size: number;
}> {
    
  // Check file stats before reading
  const fileStats = await Deno.stat(filePath);
  if (fileStats.size === 0) {
    throw new Error("File exists but is empty (0 bytes)");
  }
  
    
  // Read file as binary
  const fileBytes = await Deno.readFile(filePath);
  
  // Use the standard Deno base64 encoder instead of custom implementation
  // std@0.190 encode() handles Uint8Array at runtime; its signature only
  // admits ArrayBuffer | string, hence the cast.
  const base64Content = encodeBase64(fileBytes as unknown as ArrayBuffer);
    
  return {
    content: base64Content,
    size: fileStats.size
  };
}

// Helper function to encode binary data to base64
function encode(data: Uint8Array): string {
  try {
    return encodeBase64(data as unknown as ArrayBuffer);
  } catch (e) {
    // Fallback method if the standard library function fails
    // Convert binary data to a format that btoa can handle
    const binary = Array.from(new Uint8Array(data))
      .map(byte => String.fromCharCode(byte))
      .join("");
      
    return btoa(binary);
  }
}

// Add direct logging to verify message structure before sending
async function logMessageStructure(message: any, prefix = "[DEBUG]") {
            
  if (message.attachments && message.attachments.length > 0) {
        for (let i = 0; i < message.attachments.length; i++) {
      const att = message.attachments[i];
                                  }
  } else {
      }
}

/**
 * Decodes a base64 string to a Uint8Array
 * @param base64 - The base64 string to decode
 * @returns Uint8Array of decoded bytes
 */
function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts a Uint8Array to a base64 string
 * @param bytes - The Uint8Array to convert
 * @returns Base64 encoded string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Sends an email with an attachment
 * @param to Recipient email address
 * @param subject Email subject
 * @param text Plain text content
 * @param html HTML content (optional)
 * @param filePath Path to the file to attach (optional)
 * @param fileName Name to display for the attachment (optional)
 * @returns Promise that resolves to an object with email sending status and attachment info
 */
export async function sendEmailWithAttachment(
  to: string,
  subject: string,
  text: string,
  html?: string,
  filePath?: string,
  fileName?: string
): Promise<any> {
  // Track attachment details for response (declared outside the try so the
  // outer catch can still report attachment state on unexpected errors)
  const attachmentInfo: {
    attached: boolean;
    path: string | null;
    size: number;
    error: string | null;
    fileType?: string;
  } = {
    attached: false,
    path: filePath || null,
    size: 0,
    error: null
  };

  try {

    // Check if email configuration is valid before attempting to initialize
    if (!EMAIL_CONFIG.username || !EMAIL_CONFIG.password) {
      await logEmailActivity("EMAIL_CONFIG_ERROR", {
        recipient: to,
        subject: subject,
        error: "SMTP credentials not configured"
      });
      return {
        success: false,
        error: "SMTP credentials not configured. Check environment variables.",
        attachment_success: false
      };
    }
    
    if (!EMAIL_CONFIG.username.includes('@')) {
      await logEmailActivity("EMAIL_CONFIG_ERROR", {
        recipient: to,
        subject: subject,
        error: "SMTP username is not a valid email address"
      });
      return {
        success: false,
        error: "SMTP username is not a valid email address. Must include @.",
        attachment_success: false
      };
    }
    
    // Validate that the SMTP transport can be constructed before doing any
    // potentially expensive attachment work.
    try {
      if (!initializeClient()) {
        return {
          success: false,
          error: "Failed to initialize SMTP client",
          attachment_success: false
        };
      }
    } catch (initError) {
      await logEmailActivity("EMAIL_INIT_ERROR", {
        recipient: to,
        subject: subject,
        error: initError instanceof Error ? initError.message : String(initError)
      });
      return {
        success: false,
        error: initError instanceof Error ? initError.message : String(initError),
        attachment_success: false
      };
    }

    // Create message using our helper
    const message = {
      from: getFormattedFromAddress(),
      to: to,
      subject: subject,
      text: text,
      html: html,
      attachments: []
    };
    
    // Add attachment if provided
    if (filePath) {
      try {
                        
        // Enhanced file existence check
        let fileExists = false;
        let foundFileSize = 0;
        let fileError = null;
        let finalPath = filePath;
        
        try {
          const fileInfo = await Deno.stat(filePath);
          fileExists = true;
          foundFileSize = fileInfo.size;
          attachmentInfo.size = fileInfo.size;
                  } catch (directPathError) {
                    fileError = directPathError instanceof Error ? directPathError.message : String(directPathError);
          attachmentInfo.error = fileError;
          
          // Try to find the file using the FileCheckService
          try {
            // Get file name from path
            const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
            
            if (fileName) {
                            
              // Import dynamically to avoid circular dependency
              const { FileCheckService } = await import('./fileCheckService.ts');
              const results = await FileCheckService.findInStorage(fileName);
              
              // Find any successful matches
              const found = results.filter(r => r.exists);
              
              if (found.length > 0) {
                                found.forEach((result, i) => {
                                  });
                
                // Use the first found file
                finalPath = found[0].path;
                    fileExists = true;
                foundFileSize = found[0].size || 0;
                attachmentInfo.path = finalPath;
                attachmentInfo.size = foundFileSize;
              } else {
                await logEmailActivity("DOCUMENT_NOT_FOUND", {
                  recipient: to,
                  document: subject,
                  document_path: filePath,
                  error: "File not found in any storage location"
                });
              }
            }
          } catch (searchError) {
            attachmentInfo.error = searchError instanceof Error ? searchError.message : String(searchError);
          }
        }
        
        if (!fileExists) {
          await logEmailActivity("FILE_ATTACHMENT_FAILED", {
            file_path: filePath,
            error: "File does not exist at any tried path",
            to: to,
            subject: subject
          });
        } else {
          // File exists, validate file type before attaching
          const fileType = await getFileType(finalPath);
          attachmentInfo.fileType = fileType;
          
          // Define allowed file types (primarily PDFs, but with some flexibility)
          const allowedTypes = [
            'application/pdf', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ];
          
          
          if (!allowedTypes.includes(fileType) && 
              !fileType.includes('pdf') && 
              !finalPath.toLowerCase().endsWith('.pdf')) {
            await logEmailActivity("INVALID_FILE_TYPE", {
              file_path: finalPath,
              file_type: fileType,
              to: to,
              subject: subject
            });
            
            attachmentInfo.error = `Invalid file type: ${fileType}. Only PDF documents are allowed.`;
            
            // Continue sending email without attachment
                        
            return {
              success: true, // Email will still be sent
              attachment_success: false,
              fileExists: true,
              fileType: fileType,
              documentPath: finalPath,
              error: `Invalid file type: ${fileType}. Only PDF documents are allowed.`
            };
          }
          
          // File exists and is valid, read and attach it
          try {
                        
            // Check if file exists and its size
            const fileInfo = await Deno.stat(finalPath);
            
            if (fileInfo.size === 0) {
              throw new Error(`File exists but is empty (0 bytes): ${finalPath}`);
            }
            
                        
            // Read the file directly as binary data
            const fileContent = await Deno.readFile(finalPath);
                        
            // Convert to base64
            const base64Content = uint8ArrayToBase64(fileContent);
                        
            // Add attachment directly (simpler approach)
            message.attachments = [{
              filename: fileName || finalPath.split('/').pop() || finalPath.split('\\').pop() || 'attachment.pdf',
              content: base64Content,
              contentType: fileType || 'application/pdf',
              encoding: 'base64'
            }] as any; // Use type assertion to bypass the type checking
            
                        
            // Log message structure to verify attachment was added properly
            await logMessageStructure(message, "[SMTP]");
            
            attachmentInfo.attached = true;
            attachmentInfo.size = fileInfo.size;
            
                                  } catch (error) {
          }
        }
      } catch (fileError) {
        // Continue sending email without attachment
                        
        attachmentInfo.error = fileError instanceof Error ? fileError.message : String(fileError);
        
        await logEmailActivity("FILE_ATTACHMENT_FAILED", {
          file_path: filePath,
          error: fileError instanceof Error ? fileError.message : String(fileError),
          stage: "general_error",
          to: to
        });
      }
    }
    
    // Verify message has attachments if they were expected
    if (filePath && (!message.attachments || message.attachments.length === 0)) {
      // Try to add attachment one more time directly
      try {
        const fileContent = await Deno.readFile(filePath);
        const base64Content = uint8ArrayToBase64(fileContent);
        message.attachments = [{
          filename: fileName || filePath.split('/').pop() || filePath.split('\\').pop() || 'document.pdf',
          content: base64Content,
          contentType: 'application/pdf',
          encoding: 'base64',
          contentDisposition: 'attachment',
          headers: {
            'Content-Transfer-Encoding': 'base64',
            'Content-Type': 'application/pdf'
          }
        }] as any;
        
                
        // Log the final message structure
        await logMessageStructure(message, "[SMTP FINAL]");
      } catch (lastError) {
      }
    }
    
    // Send the email with better error handling
    try {
        
    await sendSmtpMessage(message);
        
    // Log clear confirmation about attachment status
    if (filePath && message.attachments) {
          } else if (filePath && !message.attachments) {
          }
    
      // Return detailed status
      return {
        success: true,
        attachment_success: attachmentInfo.attached,
        fileExists: attachmentInfo.attached,
        documentPath: attachmentInfo.path,
        fileSize: attachmentInfo.size,
        fileType: attachmentInfo.fileType,
        error: null
      };
    } catch (sendError) {
      // Handle specific error types
      const errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
      
      let friendlyError = "Unknown email error";
      
      // Check for common SMTP errors
      if (errorMessage.includes("535") || errorMessage.includes("Username and Password not accepted")) {
        friendlyError = "Authentication failed. Please check your email username and password.";
      } else if (errorMessage.includes("Connection refused") || errorMessage.includes("ECONNREFUSED")) {
        friendlyError = "Connection to email server refused. Check server settings and firewall.";
      } else if (errorMessage.includes("timeout")) {
        friendlyError = "Connection to email server timed out. Check network settings.";
      } else if (errorMessage.includes("certificate")) {
        friendlyError = "SSL/TLS certificate error. Check your security settings.";
      } else {
        friendlyError = `Email error: ${errorMessage}`;
      }
    await logEmailActivity("EMAIL_SEND_ERROR", {
        recipient: to,
        subject: subject,
        error: errorMessage,
        friendly_error: friendlyError,
        error_stack: sendError instanceof Error ? sendError.stack : 'No stack trace'
      });
      
      return {
        success: false,
        error: friendlyError,
        documentPath: attachmentInfo.path,
        fileExists: attachmentInfo.attached,
        fileSize: attachmentInfo.size,
        attachment_success: attachmentInfo.attached
      };
    }
  } catch (error) {
    await logEmailActivity("EMAIL_UNEXPECTED_ERROR", {
      recipient: to,
      subject: subject,
      error: error instanceof Error ? error.message : String(error),
      error_stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    
    return {
      success: false,
      error: "Unexpected error in email service. See logs for details.",
      documentPath: attachmentInfo.path,
      fileExists: attachmentInfo.attached,
      fileSize: attachmentInfo.size,
      attachment_success: attachmentInfo.attached
    };
  }
}
