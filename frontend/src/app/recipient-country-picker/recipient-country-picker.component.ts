import { Component, EventEmitter, Input, OnChanges, Output, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MaterialModule } from '../material.module';
import { RecipientCountry } from '../models';

interface CountryOption {
  countryCode: string;
  name: string;
}

interface CountryGroup {
  label: string;
  countries: CountryOption[];
}

const GROUPS = [
  { key: 'sepaEea', label: 'SEPA · European Economic Area' },
  { key: 'sepaOther', label: 'SEPA · Outside the EEA' },
  { key: 'ukLocal', label: 'UK · Domestic' },
  { key: 'usLocal', label: 'US · Domestic' }
];

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

function groupCountries(countries: RecipientCountry[]): CountryGroup[] {
  return GROUPS
    .map(({ key, label }) => ({
      label,
      countries: countries
        .filter(country => country.group === key)
        .map(country => ({ countryCode: country.countryCode, name: countryNames.of(country.countryCode) || country.countryCode }))
        .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    }))
    .filter(group => group.countries.length > 0);
}

// Lower is better, -1 means no match: an exact code first, so that typing "es" puts Spain before Estonia.
function matchRank(country: CountryOption, term: string): number {
  const code = country.countryCode.toLowerCase();
  const name = country.name.toLowerCase();
  if (code === term) return 0;
  if (name.startsWith(term)) return 1;
  if (code.startsWith(term) || name.includes(term)) return 2;
  return -1;
}

function filterGroups(groups: CountryGroup[], query: string): CountryGroup[] {
  const term = query.trim().toLowerCase();
  if (!term) return groups;

  return groups
    .map(group => ({
      label: group.label,
      matches: group.countries
        .map(country => ({ country, rank: matchRank(country, term) }))
        .filter(match => match.rank >= 0)
        .sort((left, right) => left.rank - right.rank)
    }))
    .filter(group => group.matches.length > 0)
    // Enter picks the first option, so the group holding the best match goes first: "ch" must give Switzerland, not Czechia.
    .sort((left, right) => left.matches[0].rank - right.matches[0].rank)
    .map(group => ({ label: group.label, countries: group.matches.map(match => match.country) }));
}

@Component({
  selector: 'app-recipient-country-picker',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  templateUrl: './recipient-country-picker.component.html',
  styleUrl: './recipient-country-picker.component.css',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => RecipientCountryPickerComponent), multi: true }
  ]
})
export class RecipientCountryPickerComponent implements ControlValueAccessor, OnChanges {

  @Input() countries: RecipientCountry[] = [];
  // Lets the page tie its visible <label for> to the search input.
  @Input() inputId: string | null = null;
  @Output() countryChange = new EventEmitter<string>();

  search = new FormControl<string | CountryOption | null>('');
  groups: CountryGroup[] = [];
  filteredGroups: CountryGroup[] = [];

  private countryCode = '';
  private onChange: (countryCode: string) => void = () => {};
  onTouched: () => void = () => {};

  constructor() {
    this.search.valueChanges.subscribe(value => {
      if (value && typeof value === 'object') return;

      this.filteredGroups = filterGroups(this.groups, value || '');
      if (this.countryCode) {
        this.select('');
      }
    });
  }

  ngOnChanges() {
    this.groups = groupCountries(this.countries);
    this.showSelectedCountry();
  }

  displayCountry = (value: string | CountryOption | null): string =>
    value && typeof value === 'object' ? value.name : (value || '');

  onOptionSelected(event: MatAutocompleteSelectedEvent) {
    this.filteredGroups = this.groups;
    this.select(event.option.value.countryCode);
  }

  // Text left without a selection would look like a chosen country.
  // Material's requireSelection is not used for this: it stops forwarding the typed text, which the filter relies on.
  onPanelClosed() {
    if (!this.countryCode) {
      this.search.setValue('', { emitEvent: false });
      this.filteredGroups = this.groups;
    }
  }

  writeValue(countryCode: string | null) {
    this.countryCode = countryCode || '';
    this.showSelectedCountry();
  }

  registerOnChange(fn: (countryCode: string) => void) {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean) {
    if (disabled) {
      this.search.disable({ emitEvent: false });
    } else {
      this.search.enable({ emitEvent: false });
    }
  }

  private select(countryCode: string) {
    this.countryCode = countryCode;
    this.onChange(countryCode);
    this.countryChange.emit(countryCode);
  }

  private showSelectedCountry() {
    const selected = this.groups
      .flatMap(group => group.countries)
      .find(country => country.countryCode === this.countryCode);
    this.search.setValue(selected ?? '', { emitEvent: false });
    this.filteredGroups = this.groups;
  }
}
