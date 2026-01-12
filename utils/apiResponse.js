/**
 * Standard Error Codes for the API
 */
export const ErrorCodes = {
    // Authentication & Authorization (1000-1099)
    UNAUTHORIZED: { code: 1001, message: 'Authentication required', status: 401 },
    INVALID_CREDENTIALS: { code: 1002, message: 'Invalid email or password', status: 401 },
    TOKEN_EXPIRED: { code: 1003, message: 'Authentication token has expired', status: 401 },
    TOKEN_INVALID: { code: 1004, message: 'Invalid authentication token', status: 401 },
    FORBIDDEN: { code: 1005, message: 'Access forbidden', status: 403 },
    INSUFFICIENT_PERMISSIONS: { code: 1006, message: 'Insufficient permissions for this action', status: 403 },

    // Validation Errors (1100-1199)
    VALIDATION_ERROR: { code: 1100, message: 'Validation failed', status: 400 },
    REQUIRED_FIELD_MISSING: { code: 1101, message: 'Required field is missing', status: 400 },
    INVALID_INPUT: { code: 1102, message: 'Invalid input provided', status: 400 },
    INVALID_FORMAT: { code: 1103, message: 'Invalid data format', status: 400 },
    DUPLICATE_ENTRY: { code: 1104, message: 'Duplicate entry exists', status: 409 },

    // Resource Errors (1200-1299)
    RESOURCE_NOT_FOUND: { code: 1200, message: 'Resource not found', status: 404 },
    PROJECT_NOT_FOUND: { code: 1201, message: 'Project not found', status: 404 },
    TASK_NOT_FOUND: { code: 1202, message: 'Task not found', status: 404 },
    SPRINT_NOT_FOUND: { code: 1203, message: 'Sprint not found', status: 404 },
    MODULE_NOT_FOUND: { code: 1204, message: 'Module not found', status: 404 },
    USER_NOT_FOUND: { code: 1205, message: 'User not found', status: 404 },

    // Business Logic Errors (1300-1399)
    WORKLOAD_EXCEEDED: { code: 1301, message: 'Developer workload limit exceeded', status: 400 },
    INVALID_STATUS_TRANSITION: { code: 1302, message: 'Invalid status transition', status: 400 },
    PROJECT_MEMBERSHIP_REQUIRED: { code: 1303, message: 'User must be a project member', status: 403 },
    CANNOT_REASSIGN_TASK: { code: 1304, message: 'Cannot reassign task to another user', status: 403 },
    CANNOT_DELETE_RESOURCE: { code: 1305, message: 'Cannot delete resource with dependencies', status: 400 },

    // Database Errors (1400-1499)
    DATABASE_ERROR: { code: 1400, message: 'Database operation failed', status: 500 },
    TRANSACTION_FAILED: { code: 1401, message: 'Transaction failed', status: 500 },
    CONSTRAINT_VIOLATION: { code: 1402, message: 'Database constraint violation', status: 400 },

    // Server Errors (1500-1599)
    INTERNAL_SERVER_ERROR: { code: 1500, message: 'Internal server error', status: 500 },
    SERVICE_UNAVAILABLE: { code: 1501, message: 'Service temporarily unavailable', status: 503 },
    TIMEOUT: { code: 1502, message: 'Request timeout', status: 408 },
};

/**
 * Custom API Error Class
 */
export class ApiError extends Error {
    constructor(errorCode, customMessage = null, details = null) {
        const errorInfo = errorCode || ErrorCodes.INTERNAL_SERVER_ERROR;
        super(customMessage || errorInfo.message);

        this.code = errorInfo.code;
        this.status = errorInfo.status;
        this.details = details;
        this.timestamp = new Date().toISOString();

        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Success Response Helper
 */
export const successResponse = (res, data, statusCode = 200, meta = null) => {
    const response = {
        success: true,
        data,
    };

    if (meta) {
        response.meta = meta;
    }

    return res.status(statusCode).json(response);
};

/**
 * Error Response Helper
 */
export const errorResponse = (res, error, customMessage = null, details = null) => {
    let errorInfo;
    let status;
    let code;
    let message;
    let errorDetails = details;

    // If error is an ApiError instance
    if (error instanceof ApiError) {
        status = error.status;
        code = error.code;
        message = customMessage || error.message;
        errorDetails = error.details || details;
    }
    // If error is an ErrorCode object
    else if (error && typeof error === 'object' && error.code && error.status) {
        status = error.status;
        code = error.code;
        message = customMessage || error.message;
    }
    // If error is a string (legacy support)
    else if (typeof error === 'string') {
        status = 500;
        code = ErrorCodes.INTERNAL_SERVER_ERROR.code;
        message = error;
    }
    // If error is a standard Error object
    else if (error instanceof Error) {
        status = 500;
        code = ErrorCodes.INTERNAL_SERVER_ERROR.code;
        message = customMessage || error.message;

        // Handle specific database errors
        if (error.code === '23505') { // Unique violation
            status = 409;
            code = ErrorCodes.DUPLICATE_ENTRY.code;
            message = 'Duplicate entry exists';
        } else if (error.code === '23503') { // Foreign key violation
            status = 400;
            code = ErrorCodes.CONSTRAINT_VIOLATION.code;
            message = 'Referenced resource does not exist';
        } else if (error.code === '23502') { // Not null violation
            status = 400;
            code = ErrorCodes.REQUIRED_FIELD_MISSING.code;
            message = 'Required field is missing';
        }
    }
    // Fallback
    else {
        status = 500;
        code = ErrorCodes.INTERNAL_SERVER_ERROR.code;
        message = 'An unexpected error occurred';
    }

    const response = {
        success: false,
        error: {
            code,
            message,
            timestamp: new Date().toISOString(),
        },
    };

    if (errorDetails) {
        response.error.details = errorDetails;
    }

    // Include stack trace in development
    if (process.env.NODE_ENV === 'development' && error instanceof Error) {
        response.error.stack = error.stack;
    }

    return res.status(status).json(response);
};

/**
 * Async Handler Wrapper - Catches errors in async route handlers
 */
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
        console.error('Async Handler Error:', error);
        errorResponse(res, error);
    });
};
