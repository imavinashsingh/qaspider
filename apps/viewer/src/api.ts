export async function api<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(path, { headers: { 'x-qaspider-token': sessionStorage.getItem('qaspider-token') ?? '', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
        const data = await response.json() as {
            error: string;
        };
        throw new Error(data.error);
    }
    return response.json() as Promise<T>;
}
