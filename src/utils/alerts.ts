import Swal from 'sweetalert2';
import { escapeHtml } from '../lib/escapeHtml';

/*
 * Every helper here takes PLAIN TEXT (names, e-mail addresses, server messages), never HTML.
 * SweetAlert2 renders `title` and `html` as HTML, so:
 *   - plain text goes in `titleText` / `text` (set as text, never parsed);
 *   - where a dialog needs markup (<strong>, a list), every value is passed through
 *     escapeHtml (src/lib/escapeHtml.ts) before it is put in the string.
 * Names and messages can come from other people (a user's own name, a team name, a 409
 * listing the members of a team), so treat every argument as untrusted.
 */

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
    titleText: message
  });
};

export const showError = (message: string) => {
  return Toast.fire({
    icon: 'error',
    titleText: message
  });
};

/**
 * Confirm a deletion. itemName and detail are plain text (escaped here). detail is an
 * optional extra line, e.g. "This will affect 3 teams and 12 users".
 */
export const confirmDelete = async (itemName: string, _itemType: string = 'item', detail?: string) => {
  const name = escapeHtml(itemName);
  const result = await swalWithStyledButtons.fire({
    titleText: 'Are you sure?',
    html: `You won't be able to revert this!<br><strong>${name}</strong> will be permanently deleted.${detail ? `<br><small>${escapeHtml(detail)}</small>` : ''}`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Yes, delete it!',
    cancelButtonText: 'No, cancel!',
    reverseButtons: true
  });

  if (result.isConfirmed) {
    swalWithStyledButtons.fire({
      titleText: 'Deleted!',
      html: `<strong>${name}</strong> has been deleted.`,
      icon: 'success',
      confirmButtonText: 'OK',
      timer: 2000,
      timerProgressBar: true
    });
    return { isConfirmed: true };
  } else if (result.dismiss === Swal.DismissReason.cancel) {
    swalWithStyledButtons.fire({
      titleText: 'Cancelled',
      html: `<strong>${name}</strong> is safe.`,
      icon: 'error',
      confirmButtonText: 'OK',
      timer: 2000,
      timerProgressBar: true
    });
    return { isConfirmed: false };
  }
  
  return { isConfirmed: false };
};

/**
 * Confirm "deleting" a team. The server deactivates the team (DELETE /api/admin/teams/:id sets
 * is_active = false): nothing is erased, so the dialog says that, and it can be reactivated
 * (POST /api/admin/teams/:id/toggle-status, or platform support). The caller reports the outcome.
 */
export const confirmDeactivateTeam = async (teamName: string) => {
  const name = escapeHtml(teamName);
  const result = await swalWithStyledButtons.fire({
    titleText: 'Deactivate this team?',
    html: `<strong>${name}</strong> will be deactivated: it no longer appears in lists and dashboards. Its data and history are kept, and it can be reactivated.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Yes, deactivate',
    cancelButtonText: 'Cancel',
    reverseButtons: true
  });
  return { isConfirmed: result.isConfirmed === true };
};

/** title and message are plain text. */
export const showAlert = (title: string, message: string, icon: 'success' | 'error' | 'warning' | 'info' = 'info') => {
  return swalWithStyledButtons.fire({
    titleText: title,
    text: message,
    icon,
    confirmButtonText: 'OK',
    customClass: {
      confirmButton: 'px-5 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-medium rounded-lg transition-colors'
    }
  });
};

// Warning for items that cannot be deleted due to dependencies. reason and the dependency
// names (from the server's 409: user, team names) are plain text, escaped here.
export const showCannotDeleteWarning = (
  itemType: 'team' | 'department' | 'user',
  reason: string,
  dependencyList?: string[]
) => {
  let html = `<p class="mb-3">${escapeHtml(reason)}</p>`;
  
  if (dependencyList && dependencyList.length > 0) {
    html += `<div class="text-left bg-gray-100 dark:bg-slate-700 rounded-lg p-3 mt-2">
      <p class="font-medium mb-2">Active ${itemType === 'department' ? 'teams/users' : 'users'}:</p>
      <ul class="list-disc list-inside text-sm">
        ${dependencyList.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
      ${dependencyList.length >= 5 ? '<p class="text-xs text-gray-500 mt-2">...and more</p>' : ''}
    </div>`;
  }

  return swalWithStyledButtons.fire({
    titleText: `Cannot Delete ${itemType.charAt(0).toUpperCase() + itemType.slice(1)}`,
    html,
    icon: 'warning',
    confirmButtonText: 'I Understand',
    customClass: {
      popup: 'swal2-compact dark:bg-slate-800',
      title: 'text-lg font-semibold dark:text-white text-amber-600',
      htmlContainer: 'text-sm dark:text-slate-300',
      confirmButton: 'px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors'
    }
  });
};

// Confirm deactivation instead of deletion. itemName is plain text, escaped here.
export const confirmDeactivate = async (itemName: string, _itemType: string = 'user') => {
  const result = await swalWithStyledButtons.fire({
    titleText: 'Deactivate User?',
    html: `<strong>${escapeHtml(itemName)}</strong> will be deactivated and will no longer be able to log in.<br><br>
           <span class="text-sm text-gray-500">This action can be reversed by reactivating the user later.</span>`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Yes, deactivate',
    cancelButtonText: 'Cancel',
    reverseButtons: true,
    customClass: {
      popup: 'swal2-compact dark:bg-slate-800',
      title: 'text-lg font-semibold dark:text-white',
      htmlContainer: 'text-sm dark:text-slate-300',
      confirmButton: 'px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors',
      cancelButton: 'px-5 py-2.5 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors mr-2',
      actions: 'gap-2'
    }
  });

  return { isConfirmed: result.isConfirmed };
};
