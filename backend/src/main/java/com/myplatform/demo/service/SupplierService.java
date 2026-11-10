package com.myplatform.demo.service;

import com.myplatform.demo.dto.SupplierDTO;
import com.myplatform.demo.dto.SupplierRequest;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.Bill;
import com.myplatform.demo.model.RecipientCountry;
import com.myplatform.demo.model.Supplier;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.BillRepository;
import com.myplatform.demo.repository.SupplierRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.util.BankDetails;
import com.myplatform.demo.util.ExpenseCategories;
import com.myplatform.demo.util.RecipientCountries;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** The suppliers a user pays bills to, and their bank details. */
@Service
public class SupplierService {

    /** The Verification of Payee results a supplier can simulate in TEST. Any other reference gets a match. */
    static final Set<String> VOP_SCENARIOS = Set.of("partialNameMatch", "noNameMatch", "nameMatchNotSupported");
    private static final String NAME_MATCH = "nameMatch";
    private static final Pattern EMAIL = Pattern.compile("[^@\\s]+@[^@\\s]+\\.[^@\\s]+");
    private static final Set<String> COUNTRIES = Set.of(Locale.getISOCountries());
    private static final int MAX_NAME = 100;
    private static final int MAX_EMAIL = 254;
    private static final int MAX_VAT_NUMBER = 30;

    private final SupplierRepository supplierRepository;
    private final BillRepository billRepository;
    private final UserRepository userRepository;

    public SupplierService(SupplierRepository supplierRepository,
                           BillRepository billRepository,
                           UserRepository userRepository) {
        this.supplierRepository = supplierRepository;
        this.billRepository = billRepository;
        this.userRepository = userRepository;
    }

    /** The suppliers of the user in alphabetical order, with what is still to pay them. */
    public List<SupplierDTO> list(String userId) {
        User user = user(userId);
        Map<Long, List<Bill>> billsBySupplier = billRepository
                .findByUserIdOrderBySequenceYearDescSequenceNumberDesc(userId).stream()
                .collect(Collectors.groupingBy(bill -> bill.getSupplier().getId()));
        String currency = InvoiceService.currency(user);
        return supplierRepository.findByUserId(userId).stream()
                .sorted(Comparator.comparing((Supplier supplier) -> supplier.getName().toLowerCase(Locale.ROOT))
                        .thenComparing(Supplier::getId))
                .map(supplier -> toDto(supplier, billsBySupplier.getOrDefault(supplier.getId(), List.of()), currency))
                .toList();
    }

    public SupplierDTO create(String userId, SupplierRequest request) {
        User user = user(userId);
        return toDto(create(user, request, null), List.of(), InvoiceService.currency(user));
    }

    /** @param demoKey marks a supplier of the demo data, null otherwise */
    Supplier create(User user, SupplierRequest request, String demoKey) {
        Supplier supplier = new Supplier();
        supplier.setUserId(user.getId());
        supplier.setDemoKey(demoKey);
        apply(supplier, request, InvoiceService.currency(user));
        return supplierRepository.save(supplier);
    }

    /** The bills keep showing the supplier as it is now; the transfers already created keep their details. */
    public SupplierDTO update(String userId, Long supplierId, SupplierRequest request) {
        User user = user(userId);
        Supplier supplier = owned(userId, supplierId);
        String currency = InvoiceService.currency(user);
        apply(supplier, request, currency);
        Supplier saved = supplierRepository.save(supplier);
        return toDto(saved, billRepository.findBySupplierId(saved.getId()), currency);
    }

    /**
     * Saves the name the supplier's bank has, after a partial match of the Verification of Payee. In TEST, the supplier
     * that simulated the partial match now gets a match, as it would with the bank.
     */
    public SupplierDTO useVerifiedName(String userId, Long supplierId, String name) {
        User user = user(userId);
        Supplier supplier = owned(userId, supplierId);
        String verified = text(name, MAX_NAME, "The name");
        if (verified == null) {
            throw new BadRequestException("The name is missing.");
        }
        supplier.setName(verified);
        if ("partialNameMatch".equals(supplier.getVopScenario())) {
            supplier.setVopScenario(null);
        }
        Supplier saved = supplierRepository.save(supplier);
        return toDto(saved, billRepository.findBySupplierId(saved.getId()), InvoiceService.currency(user));
    }

    public void delete(String userId, Long supplierId) {
        Supplier supplier = owned(userId, supplierId);
        if (billRepository.existsBySupplierId(supplier.getId())) {
            throw new ConflictException("This supplier has bills, so it can't be deleted.");
        }
        supplierRepository.delete(supplier);
    }

    /** The format of the bank details that transfers from an account in this currency take, null when it has none. */
    static String bankAccountFormat(String currency) {
        List<RecipientCountry> countries = RecipientCountries.forAccountCurrency(currency);
        return countries.isEmpty() ? null : countries.get(0).getBankAccountFormat();
    }

    private static void apply(Supplier supplier, SupplierRequest request, String currency) {
        if (request == null) {
            throw new BadRequestException("The supplier is missing.");
        }
        String name = text(request.name(), MAX_NAME, "The name");
        if (name == null) {
            throw new BadRequestException("Enter the name of the supplier, as it appears on its bank account.");
        }
        String email = text(request.email(), MAX_EMAIL, "The email address");
        if (email != null && !EMAIL.matcher(email).matches()) {
            throw new BadRequestException("Enter a valid email address, like name@example.com.");
        }
        String country = request.country() != null ? request.country().trim().toUpperCase(Locale.ROOT) : "";
        if (!COUNTRIES.contains(country)) {
            throw new BadRequestException("Choose the country of the supplier.");
        }
        String vatNumber = text(request.vatNumber(), MAX_VAT_NUMBER, "The VAT number");
        String category = text(request.defaultCategory(), 10, "The category");
        if (category != null && ExpenseCategories.find(category).isEmpty()) {
            throw new BadRequestException("Choose a category from the list.");
        }
        String scenario = vopScenario(request.vopScenario());
        applyBankDetails(supplier, request, currency);
        supplier.setName(name);
        supplier.setEmail(email);
        supplier.setCountry(country);
        supplier.setVatNumber(vatNumber != null ? vatNumber.toUpperCase(Locale.ROOT) : null);
        supplier.setDefaultCategory(category);
        supplier.setVopScenario(scenario);
    }

    /** Without bank details, the supplier can only be paid by card. */
    private static void applyBankDetails(Supplier supplier, SupplierRequest request, String currency) {
        String iban = BankDetails.normalize(request.iban());
        String accountNumber = BankDetails.normalize(request.accountNumber());
        String sortCode = BankDetails.normalize(request.sortCode());
        String routingNumber = BankDetails.normalize(request.routingNumber());
        String format = bankAccountFormat(currency);
        if (iban == null && accountNumber == null && sortCode == null && routingNumber == null) {
            format = null;
        } else if (format == null) {
            throw new BadRequestException("Transfers aren't available from a " + currency
                    + " account: leave the bank details empty and pay this supplier by card.");
        } else {
            switch (format) {
                case BankDetails.IBAN -> {
                    if (!BankDetails.validIban(iban)) {
                        throw new BadRequestException("This IBAN isn't valid: check it on the supplier's invoice.");
                    }
                    String bankCountry = BankDetails.country(format, iban);
                    if (RecipientCountries.find(currency, bankCountry).isEmpty()) {
                        throw new BadRequestException("Transfers from a " + currency + " account can't go to a bank in "
                                + bankCountry + ".");
                    }
                    accountNumber = null;
                    sortCode = null;
                    routingNumber = null;
                }
                case BankDetails.UK_LOCAL -> {
                    if (!BankDetails.validUkAccountNumber(accountNumber)) {
                        throw new BadRequestException("Enter the 8-digit account number of the supplier.");
                    }
                    if (!BankDetails.validSortCode(sortCode)) {
                        throw new BadRequestException("Enter the 6-digit sort code of the supplier's bank.");
                    }
                    iban = null;
                    routingNumber = null;
                }
                case BankDetails.US_LOCAL -> {
                    if (!BankDetails.validUsAccountNumber(accountNumber)) {
                        throw new BadRequestException("Enter the account number of the supplier: 4 to 17 digits.");
                    }
                    if (!BankDetails.validRoutingNumber(routingNumber)) {
                        throw new BadRequestException("Enter a valid 9-digit ABA routing number.");
                    }
                    iban = null;
                    sortCode = null;
                }
                default -> throw new IllegalStateException("Unsupported bank account format: " + format);
            }
        }
        supplier.setBankAccountFormat(format);
        supplier.setIban(format != null ? iban : null);
        supplier.setAccountNumber(format != null ? accountNumber : null);
        supplier.setSortCode(format != null ? sortCode : null);
        supplier.setRoutingNumber(format != null ? routingNumber : null);
    }

    /** The Verification of Payee result the supplier simulates in TEST, null for a match. */
    static String vopScenario(String value) {
        String scenario = text(value, 40, "The Verification of Payee result");
        if (scenario == null || NAME_MATCH.equals(scenario)) {
            return null;
        }
        if (!VOP_SCENARIOS.contains(scenario)) {
            throw new BadRequestException("Choose a Verification of Payee result from the list.");
        }
        return scenario;
    }

    /** The value without surrounding or repeated spaces, null when blank. */
    static String text(String value, int maxLength, String label) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String cleaned = value.trim().replaceAll("\\s+", " ");
        if (cleaned.length() > maxLength) {
            throw new BadRequestException(label + " can have up to " + maxLength + " characters.");
        }
        return cleaned;
    }

    private static SupplierDTO toDto(Supplier supplier, List<Bill> bills, String currency) {
        long outstanding = bills.stream()
                .filter(bill -> bill.getStatus() != Bill.Status.PAID)
                .mapToLong(Bill::getTotal)
                .sum();
        String format = supplier.getBankAccountFormat();
        return new SupplierDTO(supplier.getId(), supplier.getName(), supplier.getEmail(), supplier.getCountry(),
                supplier.getVatNumber(), format, supplier.getIban(), supplier.getAccountNumber(), supplier.getSortCode(),
                supplier.getRoutingNumber(),
                BankDetails.masked(format, supplier.getIban(), supplier.getAccountNumber(), supplier.getSortCode()),
                BankDetails.country(format, supplier.getIban()), supplier.getDefaultCategory(), supplier.getVopScenario(),
                supplier.getCreatedAt(), bills.size(), outstanding, currency);
    }

    private User user(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private Supplier owned(String userId, Long supplierId) {
        return supplierRepository.findByIdAndUserId(supplierId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("Supplier not found"));
    }
}
