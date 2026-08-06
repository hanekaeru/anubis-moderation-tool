import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

/** Chiffre isole : une valeur qui n'a pas besoin d'un graphique pour se lire. */
@Component({
  selector: 'app-stat-card',
  imports: [MatCardModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card appearance="outlined" class="stat">
      <div class="content">
        <div class="text">
          <p class="label">{{ label() }}</p>
          <p class="value">{{ value() }}</p>
          @if (hint()) {
            <p class="hint">{{ hint() }}</p>
          }
        </div>
        @if (icon()) {
          <mat-icon class="icon">{{ icon() }}</mat-icon>
        }
      </div>
    </mat-card>
  `,
  styles: `
    .content {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
    }

    .label {
      margin: 0;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--mat-sys-on-surface-variant);
    }

    .value {
      margin: 6px 0 0;
      font-size: 2rem;
      font-weight: 500;
      line-height: 1.1;
    }

    .hint {
      margin: 4px 0 0;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .icon {
      color: var(--mat-sys-primary);
      opacity: 0.5;
      font-size: 32px;
      width: 32px;
      height: 32px;
    }
  `,
})
export class StatCard {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly hint = input<string>();
  readonly icon = input<string>();
}
