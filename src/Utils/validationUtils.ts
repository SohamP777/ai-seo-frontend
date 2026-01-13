/**
 * Validation Utilities
 * Common validation functions for forms and data
 */

import { VALIDATION } from './constants';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export const validateUrl = (url: string): ValidationResult => {
  const errors: string[] = [];

  if (!url.trim()) {
    errors.push('URL is required');
  } else if (url.length > VALIDATION.MAX_URL_LENGTH) {
    errors.push(`URL must be less than ${VALIDATION.MAX_URL_LENGTH} characters`);
  } else if (!VALIDATION.URL_REGEX.test(url)) {
    errors.push('Please enter a valid URL');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const validateEmail = (email: string): ValidationResult => {
  const errors: string[] = [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email.trim()) {
    errors.push('Email is required');
  } else if (!emailRegex.test(email)) {
    errors.push('Please enter a valid email address');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const validatePassword = (password: string): ValidationResult => {
  const errors: string[] = [];

  if (!password.trim()) {
    errors.push('Password is required');
  } else if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  } else if (!/(?=.*[a-z])/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  } else if (!/(?=.*[A-Z])/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  } else if (!/(?=.*\d)/.test(password)) {
    errors.push('Password must contain at least one number');
  } else if (!/(?=.*[@$!%*?&])/.test(password)) {
    errors.push('Password must contain at least one special character (@$!%*?&)');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const validateNumber = (
  value: number | string,
  options: {
    min?: number;
    max?: number;
    required?: boolean;
    integer?: boolean;
  } = {}
): ValidationResult => {
  const errors: string[] = [];
  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (options.required && (value === undefined || value === null || value === '')) {
    errors.push('This field is required');
    return { isValid: false, errors };
  }

  if (isNaN(num)) {
    errors.push('Please enter a valid number');
    return { isValid: false, errors };
  }

  if (options.integer && !Number.isInteger(num)) {
    errors.push('Value must be an integer');
  }

  if (options.min !== undefined && num < options.min) {
    errors.push(`Value must be at least ${options.min}`);
  }

  if (options.max !== undefined && num > options.max) {
    errors.push(`Value must be at most ${options.max}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const validateRequired = (value: any, fieldName: string = 'Field'): ValidationResult => {
  const errors: string[] = [];

  if (value === undefined || value === null || value === '') {
    errors.push(`${fieldName} is required`);
  } else if (Array.isArray(value) && value.length === 0) {
    errors.push(`${fieldName} must have at least one item`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export const validateForm = <T extends Record<string, any>>(
  data: T,
  validators: Record<keyof T, (value: any) => ValidationResult>
): {
  isValid: boolean;
  errors: Record<keyof T, string[]>;
  hasErrors: boolean;
} => {
  const errors: Record<keyof T, string[]> = {} as Record<keyof T, string[]>;
  let isValid = true;

  for (const field in validators) {
    const validator = validators[field];
    const result = validator(data[field]);
    
    errors[field] = result.errors;
    if (!result.isValid) {
      isValid = false;
    }
  }

  return {
    isValid,
    errors,
    hasErrors: !isValid,
  };
};

export const sanitizeInput = (input: string): string => {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/javascript:/gi, '') // Remove JavaScript protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .substring(0, VALIDATION.MAX_URL_LENGTH); // Limit length
};