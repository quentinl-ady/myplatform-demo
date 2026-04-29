import { Component, signal, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MaterialModule } from '../material.module';
import { PosPaymentRequest, PosPaymentResponse, Store, TerminalResponse } from '../models';
import { PaymentService, StoreService } from '../services';

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MaterialModule
  ],
  templateUrl: './pos.component.html',
  styleUrl: './pos.component.css'
})
export class PosComponent implements OnInit {
  userId = '';
  readonly stores = signal<Store[]>([]);
  readonly terminals = signal<TerminalResponse[]>([]);

  readonly loadingStores = signal(false);
  readonly loadingTerminals = signal(false);
  readonly isPaying = signal(false);
  readonly paymentResult = signal<PosPaymentResponse | null>(null);

  posForm: FormGroup;

  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private paymentService = inject(PaymentService);
  private storeService = inject(StoreService);
  private matSnackBar = inject(MatSnackBar);

  constructor() {
    this.posForm = this.fb.group({
      storeId: ['', Validators.required],
      terminalId: [{ value: '', disabled: true }, Validators.required],
      amount: [null, [Validators.required, Validators.min(0)]],
      currency: ['EUR', Validators.required],
      reference: ['', Validators.required]
    });
  }

  ngOnInit() {
    this.route.parent?.paramMap.subscribe(params => {
      this.userId = params.get('id') || '';
      if (this.userId) {
        this.loadStores();
      }
    });

    this.posForm.get('storeId')?.valueChanges.subscribe(storeId => {
      if (storeId) {
        this.loadTerminals(storeId);
      } else {
        this.terminals.set([]);
        this.posForm.get('terminalId')?.disable();
      }
    });
  }

  private loadStores(): void {
    this.loadingStores.set(true);
    this.storeService.getStores(Number(this.userId)).subscribe({
      next: (res) => {
        this.stores.set(res || []);
        this.loadingStores.set(false);
      },
      error: () => {
        this.matSnackBar.open('Error loading stores', 'Close', { duration: 3000 });
        this.loadingStores.set(false);
      }
    });
  }

  private loadTerminals(storeId: string): void {
    this.loadingTerminals.set(true);
    this.posForm.get('terminalId')?.disable();

    this.storeService.listTerminals(storeId).subscribe({
      next: (res) => {
        this.terminals.set(res || []);
        if (this.terminals().length > 0) {
          this.posForm.get('terminalId')?.enable();
        }
        this.loadingTerminals.set(false);
      },
      error: () => {
        this.matSnackBar.open('Error loading terminals', 'Close', { duration: 3000 });
        this.terminals.set([]);
        this.loadingTerminals.set(false);
      }
    });
  }

  onSubmit(): void {
    if (this.posForm.invalid) {
      this.posForm.markAllAsTouched();
      this.matSnackBar.open('Invalid form, please check the fields', 'Close', { duration: 2500 });
      return;
    }

    const rawAmount = Number(this.posForm.get('amount')?.value);
    const minorUnitsAmount = Math.round(rawAmount * 100);

    const payload: PosPaymentRequest = {
      reference: this.posForm.get('reference')?.value,
      amount: minorUnitsAmount,
      currency: this.posForm.get('currency')?.value,
      terminalId: this.posForm.get('terminalId')?.value
    };

    this.isPaying.set(true);
    this.paymentResult.set(null);

    this.paymentService.makePosPayment(payload).subscribe({
      next: (res) => {
        this.paymentResult.set(res);
        this.isPaying.set(false);
      },
      error: () => {
        this.matSnackBar.open('Error communicating with the terminal', 'Close', { duration: 3000 });
        this.paymentResult.set({
          status: 'ERROR',
          pspReference: '',
          cardBrand: '',
          maskedPan: '',
          errorCondition: 'Network or API Error',
          refusalReason: '',
          reference: payload.reference
        });
        this.isPaying.set(false);
      }
    });
  }

  resetPayment(): void {
    this.paymentResult.set(null);
    this.posForm.patchValue({
      amount: null,
      reference: ''
    });
    this.posForm.get('amount')?.markAsUntouched();
    this.posForm.get('reference')?.markAsUntouched();
  }
}
