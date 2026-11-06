import { Injectable, inject } from '@angular/core';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';

/** Long messages stay longer so they can be read to the end. */
function readingTime(message: string, minimum: number): number {
  return Math.min(10_000, Math.max(minimum, message.length * 60));
}

/**
 * Snack bars confirm that an action finished. A failure that belongs to a form
 * or a section of the page is shown there with app-inline-alert; `error` is
 * only for failures with no natural place on screen, and it stays until it is
 * dismissed so nobody misses it.
 */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): MatSnackBarRef<TextOnlySnackBar> {
    return this.snackBar.open(message, 'Close', {
      duration: readingTime(message, 4000),
      panelClass: 'fintech-snack-success',
    });
  }

  info(message: string): MatSnackBarRef<TextOnlySnackBar> {
    return this.snackBar.open(message, 'Close', { duration: readingTime(message, 4000) });
  }

  error(message: string): MatSnackBarRef<TextOnlySnackBar> {
    return this.snackBar.open(message, 'Close', {
      panelClass: 'fintech-snack-error',
      politeness: 'assertive',
    });
  }

  /** Confirms a reversible action and offers to take it back. */
  undoable(message: string, undo: () => void): MatSnackBarRef<TextOnlySnackBar> {
    const ref = this.snackBar.open(message, 'Undo', { duration: readingTime(message, 8000) });
    ref.onAction().subscribe(undo);
    return ref;
  }
}
