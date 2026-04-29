import { Pipe, PipeTransform } from '@angular/core';
import { PayoutConfiguration } from '../models';

@Pipe({
    name: 'payoutType',
    standalone: true
})
export class PayoutTypePipe implements PipeTransform {
    transform(config: PayoutConfiguration): string {
        if (!config) return '';
        const types = [];
        if (config.regular) types.push('Regular');
        if (config.instant) types.push('Instant');
        return types.join(', ');
    }
}
