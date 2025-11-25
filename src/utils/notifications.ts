// Custom notification system using vanilla JS approach in React
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export function showNotification(message: string, type: NotificationType = 'info') {
  const notification = document.createElement('div');
  notification.className = `fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm transform translate-x-full transition-transform duration-300`;
  
  switch (type) {
    case 'success':
      notification.classList.add('bg-green-500', 'text-white');
      break;
    case 'error':
      notification.classList.add('bg-red-500', 'text-white');
      break;
    case 'warning':
      notification.classList.add('bg-yellow-500', 'text-white');
      break;
    default:
      notification.classList.add('bg-blue-500', 'text-white');
  }
  
  const iconMap = {
    success: 'check-circle',
    error: 'times-circle',
    warning: 'exclamation-circle',
    info: 'info-circle'
  };
  
  notification.innerHTML = `
    <div class="flex items-center space-x-3">
      <i class="fas fa-${iconMap[type]} text-xl"></i>
      <span class="font-medium">${message}</span>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Animate in
  setTimeout(() => {
    notification.classList.remove('translate-x-full');
  }, 100);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.classList.add('translate-x-full');
    setTimeout(() => {
      if (notification.parentNode) {
        document.body.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

// Convenience methods
export const notify = {
  success: (message: string) => showNotification(message, 'success'),
  error: (message: string) => showNotification(message, 'error'),
  warning: (message: string) => showNotification(message, 'warning'),
  info: (message: string) => showNotification(message, 'info')
};
