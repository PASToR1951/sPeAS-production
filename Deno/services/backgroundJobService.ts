/**
 * Background Job Service
 * Handles asynchronous execution of long-running tasks like email sending
 */

import { ensureDir } from "https://deno.land/std@0.190.0/fs/ensure_dir.ts";
import { join } from "../deps.ts";

// Interface for a generic job
interface Job {
  id: string;
  type: string;
  data: Record<string, any>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  error?: string;
  result?: any;
}

// Interface for an email job
interface EmailJob extends Job {
  type: 'email';
  data: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    attachmentPath?: string;
    attachmentName?: string;
    fullName?: string;
    documentTitle?: string;
    requestId?: string;
    documentId?: string;
    jobType: 'approval' | 'rejection' | 'confirmation';
    childDocumentPaths?: string[];
    documentAuthor?: string;
    documentCategory?: string;
    documentKeywords?: string;
    reason?: string;
    documentInfo?: { 
      title: string;
      author?: string;
      category?: string;
      keywords?: string;
    };
    requestInfo?: { 
      affiliation: string;
      reason: string;
      reasonDetails: string;
    };
  };
}

// In-memory job queue
const jobQueue: Job[] = [];
let isProcessing = false;
let jobIdCounter = 0;

// Initialize job service
const LOG_DIR = "./logs/jobs";
let logInitialized = false;

/**
 * Ensures the log directory exists
 */
async function initializeLogDir() {
  if (!logInitialized) {
    await ensureDir(LOG_DIR);
    logInitialized = true;
      }
}

/**
 * Creates a new job and adds it to the queue
 * @param type Job type
 * @param data Job data
 * @returns The created job
 */
export function createJob(type: string, data: Record<string, any>): Job {
  const now = new Date();
  const jobId = `job_${Date.now()}_${++jobIdCounter}`;
  
  const job: Job = {
    id: jobId,
    type,
    data,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  };
  
  jobQueue.push(job);
    
  // Trigger processing if not already running
  if (!isProcessing) {
    processNextJob();
  }
  
  return job;
}

/**
 * Gets a job by its ID
 * @param jobId The job ID
 * @returns The job or null if not found
 */
export function getJob(jobId: string): Job | null {
  return jobQueue.find(job => job.id === jobId) || null;
}

/**
 * Creates an email job
 * @param to Recipient email
 * @param subject Email subject
 * @param text Plain text email content
 * @param html HTML email content
 * @param attachmentPath Path to attachment
 * @param jobType Type of email job
 * @param additionalData Additional data for the email
 * @returns The created job
 */
export function createEmailJob(
  to: string,
  subject: string,
  text: string,
  html: string | undefined,
  attachmentPath: string | undefined,
  jobType: 'approval' | 'rejection' | 'confirmation',
  additionalData: Record<string, any> = {}
): Job {
  return createJob('email', {
    to,
    subject,
    text,
    html,
    attachmentPath,
    jobType,
    ...additionalData
  });
}

/**
 * Processes the next job in the queue
 */
async function processNextJob() {
  if (jobQueue.length === 0 || isProcessing) {
    return;
  }
  
  isProcessing = true;
  
  // Find the next pending job
  const jobIndex = jobQueue.findIndex(job => job.status === 'pending');
  
  if (jobIndex === -1) {
    isProcessing = false;
    return;
  }
  
  const job = jobQueue[jobIndex];
  
  try {
    // Update job status
    job.status = 'processing';
    job.updatedAt = new Date();
    
        
    // Process job based on type
    switch (job.type) {
      case 'email':
        await processEmailJob(job as EmailJob);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
    
    // Mark job as completed
    job.status = 'completed';
    job.updatedAt = new Date();
        
    // Log job completion
    await logJob(job);
    
  } catch (error) {
    // Handle job failure
    job.status = 'failed';
    job.updatedAt = new Date();
    job.error = error instanceof Error ? error.message : String(error);
    // Log job failure
    await logJob(job);
  } finally {
    // Continue processing next job
    isProcessing = false;
    
    // Schedule next job with a small delay to avoid blocking
    setTimeout(() => {
      processNextJob();
    }, 100);
  }
}

/**
 * Processes an email job by delegating to the email service
 * @param job The email job to process
 */
async function processEmailJob(job: EmailJob) {
  // Import email service dynamically to avoid circular dependencies
  const { sendEmailWithAttachment, sendApprovedRequestEmail, sendRejectedRequestEmail, sendRequestConfirmationEmail } = 
    await import('./emailService.ts');
  
  const { to, subject, text, html, attachmentPath, attachmentName, jobType } = job.data;
  
  if (!to || !subject) {
    throw new Error('Email job missing required fields: to, subject');
  }
  
  // Process based on specific email job type
  switch (jobType) {
    case 'approval':
      {
        const { fullName, documentTitle, documentId, childDocumentPaths, documentAuthor, documentCategory, documentKeywords } = job.data;
                job.result = await sendApprovedRequestEmail(
          to, 
          fullName || 'User', 
          documentTitle || 'Requested Document', 
          attachmentPath || String(documentId) || '', 
          job.data.requestId,
          documentAuthor,
          documentCategory,
          documentKeywords,
          childDocumentPaths
        );
      }
      break;
    
    case 'rejection':
      {
        const { fullName, documentTitle, reason } = job.data;
                job.result = await sendRejectedRequestEmail(
          to,
          fullName || 'User',
          documentTitle || 'Requested Document',
          reason || 'Your request was not approved'
        );
      }
      break;
    
    case 'confirmation':
      {
        const { fullName, requestId, documentInfo, requestInfo } = job.data;
                job.result = await sendRequestConfirmationEmail(
          to,
          fullName || 'User',
          documentInfo || { title: 'Requested Document' },
          requestInfo || { affiliation: '', reason: '', reasonDetails: '' },
          requestId || `REQ-${Date.now()}`
        );
      }
      break;
    
    default:
      // Generic email sending for other types
            job.result = await sendEmailWithAttachment(to, subject, text, html, attachmentPath, attachmentName);
      break;
  }
}

/**
 * Logs a job to a file
 * @param job The job to log
 */
async function logJob(job: Job) {
  await initializeLogDir();
  
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const logFile = join(LOG_DIR, `job-log-${date}.jsonl`);
  
  // Create a simplified log entry without potentially large data
  const logEntry = {
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    error: job.error,
    // Include minimal data for debugging, but avoid large content
    data: {
      ...(job.type === 'email' ? {
        to: (job as EmailJob).data.to,
        subject: (job as EmailJob).data.subject,
        jobType: (job as EmailJob).data.jobType,
        hasAttachment: !!((job as EmailJob).data.attachmentPath)
      } : {})
    },
    // Include success/failure info but not full result
    result: job.result ? {
      success: typeof job.result === 'object' ? job.result.success : !!job.result,
      error: typeof job.result === 'object' ? job.result.error : undefined
    } : undefined
  };
  
  try {
    await Deno.writeTextFile(logFile, JSON.stringify(logEntry) + '\n', { append: true });
  } catch (error) {
    // If the file doesn't exist, create it
    if (error instanceof Deno.errors.NotFound) {
      await Deno.writeTextFile(logFile, JSON.stringify(logEntry) + '\n');
    } else {
    }
  }
}

// Clean up old jobs periodically
setInterval(() => {
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  
  // Keep only jobs that are pending, processing, or completed/failed in the last day
  const oldJobCount = jobQueue.length;
  
  // Filter jobs, keeping recent ones and pending/processing ones
  const filteredJobs = jobQueue.filter(job => 
    job.status === 'pending' || 
    job.status === 'processing' || 
    job.updatedAt.getTime() > oneDayAgo
  );
  
  // Replace the queue with the filtered jobs
  jobQueue.length = 0;
  jobQueue.push(...filteredJobs);
  
  const removedCount = oldJobCount - jobQueue.length;
  if (removedCount > 0) {
      }
}, 3600000); // Clean up every hour 