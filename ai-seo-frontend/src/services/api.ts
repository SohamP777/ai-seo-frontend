// Any API call file (e.g., src/services/api.ts)
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const scanWebsite = async (url: string) => {
  const response = await fetch(`${API_URL}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  return response.json();
};

// In component
const handleSubmit = async () => {
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const result = await fetch(`${API_URL}/api/scan`, {...});
};