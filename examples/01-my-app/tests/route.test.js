import { describe, it, expect } from 'vitest';
import { createTestApp } from 'exisjs/testing';
// 1. We import the main app instance directly
import app from '../src/http/server';
describe('My App Routes', () => {
    // 2. We wrap it in the test client. 
    // No server is actually started on a port because of app.inject()
    const api = createTestApp(app);
    it('should return welcome message', async () => {
        // 3. We use the fluid API to send a request
        const res = await api.get('/').execute();
        // 4. We assert on the response
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ message: 'Welcome to Exis JS!' });
    });
    it('should handle POST requests', async () => {
        const res = await api.post('/')
            .set('Authorization', 'Bearer my-token')
            .send({ email: 'test@example.com', password: 'password123' })
            .execute();
        expect(res.status).toBe(200);
        // Validate schema validation responses
    });
});
