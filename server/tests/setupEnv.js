import { inject } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = inject('mongoUri');
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.BCRYPT_ROUNDS = '4';
process.env.LOGIN_MAX_ATTEMPTS = '3';
process.env.LOGIN_LOCK_MINUTES = '15';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.STORAGE_DIR = `/tmp/sfa-cms-test-storage-${process.pid}`;
process.env.UPLOAD_MAX_MB = '1';
process.env.UPLOAD_MAX_FILES = '3';
process.env.WHATSAPP_DRIVER = 'mock';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'verify-token-123';
process.env.WHATSAPP_SBUS = 'AHP-Rumicare,AHP-Poultry';
process.env.WHATSAPP_CATEGORIES = 'Packaging,Product quality,Efficacy';
