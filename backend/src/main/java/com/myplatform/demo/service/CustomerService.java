package com.myplatform.demo.service;

import com.myplatform.demo.dto.CustomerDTO;
import com.myplatform.demo.dto.CustomerRequest;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.Customer;
import com.myplatform.demo.model.Invoice;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.CustomerRepository;
import com.myplatform.demo.repository.InvoiceRepository;
import com.myplatform.demo.repository.SubscriptionRepository;
import com.myplatform.demo.repository.UserRepository;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** The customers a user invoices. */
@Service
public class CustomerService {

    private static final Pattern EMAIL = Pattern.compile("[^@\\s]+@[^@\\s]+\\.[^@\\s]+");
    private static final Set<String> COUNTRIES = Set.of(Locale.getISOCountries());
    private static final int MAX_NAME = 100;
    private static final int MAX_EMAIL = 254;
    private static final int MAX_VAT_NUMBER = 30;
    private static final int MAX_ADDRESS = 200;
    private static final int MAX_POSTAL_CODE = 20;
    private static final int MAX_CITY = 100;

    private final CustomerRepository customerRepository;
    private final InvoiceRepository invoiceRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final UserRepository userRepository;

    public CustomerService(CustomerRepository customerRepository,
                           InvoiceRepository invoiceRepository,
                           SubscriptionRepository subscriptionRepository,
                           UserRepository userRepository) {
        this.customerRepository = customerRepository;
        this.invoiceRepository = invoiceRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.userRepository = userRepository;
    }

    /** The customers of the user in alphabetical order, with what they owe. */
    public List<CustomerDTO> list(String userId) {
        User user = user(userId);
        Map<Long, List<Invoice>> invoicesByCustomer = invoiceRepository
                .findByUserIdOrderBySequenceYearDescSequenceNumberDesc(userId).stream()
                .collect(Collectors.groupingBy(invoice -> invoice.getCustomer().getId()));
        String currency = InvoiceService.currency(user);
        return customerRepository.findByUserId(userId).stream()
                .sorted(Comparator.comparing((Customer customer) -> customer.displayName().toLowerCase(Locale.ROOT))
                        .thenComparing(Customer::getId))
                .map(customer -> toDto(customer, invoicesByCustomer.getOrDefault(customer.getId(), List.of()), currency))
                .toList();
    }

    public CustomerDTO create(String userId, CustomerRequest request) {
        User user = user(userId);
        return toDto(create(user, request, null), List.of(), InvoiceService.currency(user));
    }

    /** @param demoKey marks a customer of the demo data, null otherwise */
    Customer create(User user, CustomerRequest request, String demoKey) {
        Customer customer = new Customer();
        customer.setUserId(user.getId());
        customer.setDemoKey(demoKey);
        apply(customer, request);
        return customerRepository.save(customer);
    }

    /** The invoices already issued keep showing the customer as it is now. */
    public CustomerDTO update(String userId, Long customerId, CustomerRequest request) {
        User user = user(userId);
        Customer customer = owned(userId, customerId);
        apply(customer, request);
        Customer saved = customerRepository.save(customer);
        return toDto(saved, invoiceRepository.findByCustomerId(saved.getId()), InvoiceService.currency(user));
    }

    public void delete(String userId, Long customerId) {
        Customer customer = owned(userId, customerId);
        if (subscriptionRepository.existsByCustomerId(customer.getId())) {
            throw new ConflictException("This customer has subscriptions, so it can't be deleted.");
        }
        if (invoiceRepository.existsByCustomerId(customer.getId())) {
            throw new ConflictException("This customer has invoices, so it can't be deleted.");
        }
        customerRepository.delete(customer);
    }

    private static void apply(Customer customer, CustomerRequest request) {
        if (request == null) {
            throw new BadRequestException("The customer is missing.");
        }
        String name = text(request.name(), MAX_NAME, "The name");
        if (name == null) {
            throw new BadRequestException("Enter the name of the customer.");
        }
        String email = text(request.email(), MAX_EMAIL, "The email address");
        if (email == null || !EMAIL.matcher(email).matches()) {
            throw new BadRequestException("Enter a valid email address, like name@example.com.");
        }
        String country = request.country() != null ? request.country().trim().toUpperCase(Locale.ROOT) : "";
        if (!COUNTRIES.contains(country)) {
            throw new BadRequestException("Choose the country of the customer.");
        }
        String vatNumber = text(request.vatNumber(), MAX_VAT_NUMBER, "The VAT number");
        customer.setName(name);
        customer.setCompany(text(request.company(), MAX_NAME, "The company name"));
        customer.setEmail(email);
        customer.setCountry(country);
        customer.setVatNumber(vatNumber != null ? vatNumber.toUpperCase(Locale.ROOT) : null);
        customer.setAddressLine(text(request.addressLine(), MAX_ADDRESS, "The address"));
        customer.setPostalCode(text(request.postalCode(), MAX_POSTAL_CODE, "The postal code"));
        customer.setCity(text(request.city(), MAX_CITY, "The city"));
    }

    /** The value without surrounding or repeated spaces, null when blank. */
    private static String text(String value, int maxLength, String label) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String cleaned = value.trim().replaceAll("\\s+", " ");
        if (cleaned.length() > maxLength) {
            throw new BadRequestException(label + " can have up to " + maxLength + " characters.");
        }
        return cleaned;
    }

    private static CustomerDTO toDto(Customer customer, List<Invoice> invoices, String currency) {
        long outstanding = invoices.stream()
                .filter(invoice -> invoice.getStatus() == Invoice.Status.SENT)
                .mapToLong(Invoice::getTotal)
                .sum();
        return new CustomerDTO(customer.getId(), customer.getName(), customer.getCompany(), customer.displayName(),
                customer.getEmail(), customer.getCountry(), customer.getVatNumber(), customer.getAddressLine(),
                customer.getPostalCode(), customer.getCity(), customer.getShopperReference(), customer.getCreatedAt(),
                invoices.size(), outstanding, currency);
    }

    private User user(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
    }

    private Customer owned(String userId, Long customerId) {
        return customerRepository.findByIdAndUserId(customerId, userId)
                .orElseThrow(() -> new ResourceNotFoundException("Customer not found"));
    }
}
