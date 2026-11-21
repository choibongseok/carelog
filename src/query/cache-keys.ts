export const dailyKey = (userId: string, day: string) => `summary:daily:${userId}:${day}`;
export const weeklyKey = (userId: string, weekStart: string) => `summary:weekly:${userId}:${weekStart}`;
