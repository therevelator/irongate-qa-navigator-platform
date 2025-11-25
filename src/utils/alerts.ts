import Swal from 'sweetalert2';

// Custom SweetAlert2 configuration for the app
const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  didOpen: (toast) => {
    toast.onmouseenter = Swal.stopTimer;
    toast.onmouseleave = Swal.resumeTimer;
  }
});

// Styled buttons mixin
const swalWithStyledButtons = Swal.mixin({
  customClass: {
    popup: 'swal2-compact dark:bg-slate-800',
    title: 'text-lg font-semibold dark:text-white',
    htmlContainer: 'text-sm dark:text-slate-300',
    confirmButton: 'px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors',
    cancelButton: 'px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors mr-2',
    actions: 'gap-2'
  },
  buttonsStyling: false,
  width: '400px',
  padding: '1.5rem'
});

export const showSuccess = (message: string) => {
  return Toast.fire({
    icon: 'success',
    title: message
  });
};

export const showError = (message: string) => {
  return Toast.fire({
    icon: 'error',
    title: message
  });
};

export const showInfo = (message: string) => {
  return Toast.fire({
    icon: 'info',
    title: message
  });
};

export const showWarning = (message: string) => {
  return Toast.fire({
    icon: 'warning',
    title: message
  });
};

export const confirmDelete = async (itemName: string, itemType: string = 'item') => {
  const result = await swalWithStyledButtons.fire({
    title: 'Are you sure?',
    html: `You won't be able to revert this!<br><strong>${itemName}</strong> will be permanently deleted.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Yes, delete it!',
    cancelButtonText: 'No, cancel!',
    reverseButtons: true
  });

  if (result.isConfirmed) {
    swalWithStyledButtons.fire({
      title: 'Deleted!',
      html: `<strong>${itemName}</strong> has been deleted.`,
      icon: 'success',
      confirmButtonText: 'OK',
      timer: 2000,
      timerProgressBar: true
    });
    return { isConfirmed: true };
  } else if (result.dismiss === Swal.DismissReason.cancel) {
    swalWithStyledButtons.fire({
      title: 'Cancelled',
      html: `<strong>${itemName}</strong> is safe.`,
      icon: 'error',
      confirmButtonText: 'OK',
      timer: 2000,
      timerProgressBar: true
    });
    return { isConfirmed: false };
  }
  
  return { isConfirmed: false };
};

export const confirmAction = async (title: string, message: string, confirmText: string = 'Confirm') => {
  const result = await swalWithStyledButtons.fire({
    title,
    html: message,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: 'Cancel',
    reverseButtons: true,
    customClass: {
      confirmButton: 'px-5 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-medium rounded-lg transition-colors'
    }
  });

  if (result.isConfirmed) {
    return { isConfirmed: true };
  } else if (result.dismiss === Swal.DismissReason.cancel) {
    swalWithStyledButtons.fire({
      title: 'Cancelled',
      text: 'Action was cancelled.',
      icon: 'info',
      confirmButtonText: 'OK',
      timer: 2000,
      timerProgressBar: true
    });
    return { isConfirmed: false };
  }
  
  return { isConfirmed: false };
};

export const showAlert = (title: string, message: string, icon: 'success' | 'error' | 'warning' | 'info' = 'info') => {
  return swalWithStyledButtons.fire({
    title,
    html: message,
    icon,
    confirmButtonText: 'OK',
    customClass: {
      confirmButton: 'px-5 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-medium rounded-lg transition-colors'
    }
  });
};
