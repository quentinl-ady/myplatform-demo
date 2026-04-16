import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'formatCardNumber',
  standalone: true
})
export class FormatCardNumberPipe implements PipeTransform {
  transform(value: string): string {
    if (!value) return '';
    return value.replace(/(.{4})/g, '$1 ').trim();
  }
}
