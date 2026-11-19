// Локальная версия использует существующий сервер. Сборка Pages заменяет это значение.
export const ENVIRONMENT = typeof document === 'undefined' ? 'local' : (document.documentElement.dataset.transport || 'local');
