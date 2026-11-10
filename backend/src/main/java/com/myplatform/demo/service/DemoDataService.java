package com.myplatform.demo.service;

import com.adyen.service.exception.ApiException;
import com.myplatform.demo.dto.BillDTO;
import com.myplatform.demo.dto.BillRequest;
import com.myplatform.demo.dto.CustomerRequest;
import com.myplatform.demo.dto.DemoDataResult;
import com.myplatform.demo.dto.InvoiceDTO;
import com.myplatform.demo.dto.InvoiceRequest;
import com.myplatform.demo.dto.SubscriptionDTO;
import com.myplatform.demo.dto.SubscriptionRequest;
import com.myplatform.demo.dto.SupplierRequest;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.BillEvent;
import com.myplatform.demo.model.Customer;
import com.myplatform.demo.model.InvoiceEvent;
import com.myplatform.demo.model.RecipientCountry;
import com.myplatform.demo.model.Supplier;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.BillRepository;
import com.myplatform.demo.repository.CustomerRepository;
import com.myplatform.demo.repository.InvoiceRepository;
import com.myplatform.demo.repository.SubscriptionRepository;
import com.myplatform.demo.repository.SupplierRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.util.ExpenseCategories;
import com.myplatform.demo.util.RecipientCountries;
import com.myplatform.demo.util.VatRates;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Stream;

/**
 * Fills an account with customers, invoices and a subscription, and with suppliers and their bills, so a demo starts
 * from an account that looks used. Each record has a demo key: loading the data again only creates what's missing.
 */
@Service
public class DemoDataService {

    private static final Logger log = LoggerFactory.getLogger(DemoDataService.class);

    private record DemoCustomer(String key, String name, String company, String email) {
    }

    /** @param unitPrice major units, excluding VAT */
    private record DemoLine(String description, long quantity, long unitPrice, boolean books) {
    }

    /**
     * @param customer index in {@link #CUSTOMERS}
     * @param send     issued with a payment link; the others stay drafts to send during the demo
     */
    private record DemoInvoice(String key, int customer, int issuedDaysAgo, int termsDays, boolean send, String notes,
                               List<DemoLine> lines) {
    }

    private record Address(String line, String postalCode, String city) {
    }

    /** @param byTransfer has the bank details of a test account; the others are paid by card */
    private record DemoSupplier(String key, String name, String email, String category, boolean byTransfer,
                                String vopScenario) {
    }

    /**
     * @param supplier index in {@link #SUPPLIERS}
     * @param subtotal major units, excluding VAT
     */
    private record DemoBill(String key, int supplier, String supplierReference, int issuedDaysAgo, int termsDays,
                            String description, long subtotal) {
    }
    private static final List<DemoCustomer> CUSTOMERS = List.of(
            new DemoCustomer("customer-northwind", "Emma Laurent", "Northwind Trading", "accounts@northwind-trading.example"),
            new DemoCustomer("customer-bluebird", "Lucas Martin", "Bluebird Studio", "billing@bluebird-studio.example"),
            new DemoCustomer("customer-greenleaf", "Sofia Rossi", "Greenleaf Cafés", "finance@greenleaf-cafes.example"),
            new DemoCustomer("customer-atlas", "Noah Schmidt", "Atlas Logistics", "payables@atlas-logistics.example"));

    /** In the order of their issue dates, so that their numbers follow the same order. */
    private static final List<DemoInvoice> INVOICES = List.of(
            new DemoInvoice("invoice-1", 0, 45, 30, true, null, List.of(
                    new DemoLine("Consulting: process audit (days)", 3, 650, false),
                    new DemoLine("Travel expenses", 1, 180, false))),
            new DemoInvoice("invoice-2", 1, 20, 30, true, null, List.of(
                    new DemoLine("Website maintenance, monthly plan", 1, 490, false),
                    new DemoLine("Training handbooks", 10, 15, true))),
            new DemoInvoice("invoice-3", 2, 6, 30, true, "Thank you for your business.", List.of(
                    new DemoLine("Point-of-sale setup and staff training", 1, 850, false),
                    new DemoLine("Software licence, annual (per seat)", 5, 120, false))),
            new DemoInvoice("invoice-4", 3, 0, 30, false, null, List.of(
                    new DemoLine("Logistics dashboard implementation", 1, 2400, false))),
            new DemoInvoice("invoice-5", 0, 0, 30, false, null, List.of(
                    new DemoLine("Consulting: follow-up workshop (days)", 1, 650, false))));

    /** The tax rate of books, so that an invoice shows two rates. The other countries use their standard rate. */
    private static final Map<String, String> BOOKS_RATE = Map.ofEntries(
            Map.entry("AT", "10"), Map.entry("BE", "6"), Map.entry("CH", "2.6"), Map.entry("DE", "7"),
            Map.entry("ES", "4"), Map.entry("FR", "5.5"), Map.entry("GB", "0"), Map.entry("IE", "0"),
            Map.entry("IT", "4"), Map.entry("LU", "3"), Map.entry("NL", "9"), Map.entry("PL", "5"),
            Map.entry("PT", "6"), Map.entry("SE", "6"));

    private static final Map<String, List<Address>> ADDRESSES = Map.of(
            "BE", List.of(new Address("Avenue Louise 54", "1050", "Brussels"),
                    new Address("Meir 50", "2000", "Antwerp"),
                    new Address("Veldstraat 20", "9000", "Ghent"),
                    new Address("Place Saint-Lambert 10", "4000", "Liège")),
            "DE", List.of(new Address("Friedrichstraße 68", "10117", "Berlin"),
                    new Address("Maximilianstraße 12", "80539", "München"),
                    new Address("Jungfernstieg 7", "20354", "Hamburg"),
                    new Address("Königsallee 30", "40212", "Düsseldorf")),
            "ES", List.of(new Address("Calle de Serrano 45", "28001", "Madrid"),
                    new Address("Passeig de Gràcia 21", "08007", "Barcelona"),
                    new Address("Calle Colón 10", "46004", "Valencia"),
                    new Address("Avenida de la Constitución 8", "41004", "Sevilla")),
            "FR", List.of(new Address("18 Rue de la Paix", "75002", "Paris"),
                    new Address("24 Quai Saint-Antoine", "69002", "Lyon"),
                    new Address("7 Cours Mirabeau", "13100", "Aix-en-Provence"),
                    new Address("3 Place de la Bourse", "33000", "Bordeaux")),
            "GB", List.of(new Address("221 Baker Street", "NW1 6XE", "London"),
                    new Address("12 Deansgate", "M3 2BW", "Manchester"),
                    new Address("40 George Street", "EH2 2LE", "Edinburgh"),
                    new Address("5 Temple Row", "B2 5LG", "Birmingham")),
            "IT", List.of(new Address("Via Montenapoleone 8", "20121", "Milano"),
                    new Address("Via del Corso 120", "00186", "Roma"),
                    new Address("Via de' Tornabuoni 15", "50123", "Firenze"),
                    new Address("Via Roma 50", "10121", "Torino")),
            "NL", List.of(new Address("Herengracht 182", "1016 BR", "Amsterdam"),
                    new Address("Coolsingel 40", "3011 AD", "Rotterdam"),
                    new Address("Oudegracht 120", "3511 AX", "Utrecht"),
                    new Address("Lange Voorhout 9", "2514 EA", "Den Haag")),
            "US", List.of(new Address("350 Mission Street", "94105", "San Francisco, CA"),
                    new Address("200 Park Avenue", "10166", "New York, NY"),
                    new Address("100 Congress Avenue", "78701", "Austin, TX"),
                    new Address("500 Boylston Street", "02116", "Boston, MA")));

    private static final List<String> SERIALS = List.of("123456789", "234567891", "345678912", "456789123");

    /**
     * Waits for its first payment: paying its link during the demo stores the payment method that the next cycles are
     * charged to.
     */
    private static final String SUBSCRIPTION_KEY = "subscription-1";
    /** Index in {@link #CUSTOMERS}. */
    private static final int SUBSCRIPTION_CUSTOMER = 1;
    private static final String SUBSCRIPTION_PLAN = "Website care plan";
    /** Major units a month, excluding VAT. */
    private static final long SUBSCRIPTION_PRICE = 490;

    /** The Verification of Payee of BrightPixel Marketing finds a partial match of its name, as a bank can. */
    private static final List<DemoSupplier> SUPPLIERS = List.of(
            new DemoSupplier("supplier-harbor", "Harbor Workspace", "billing@harbor-workspace.example",
                    ExpenseCategories.RENT.code(), true, null),
            new DemoSupplier("supplier-cloudnest", "CloudNest Software", "invoices@cloudnest.example",
                    ExpenseCategories.SOFTWARE.code(), true, null),
            new DemoSupplier("supplier-brightpixel", "BrightPixel Marketing", "accounts@brightpixel.example",
                    ExpenseCategories.MARKETING.code(), true, "partialNameMatch"),
            new DemoSupplier("supplier-metro", "Metro Office Supplies", "orders@metro-office.example",
                    ExpenseCategories.OFFICE.code(), false, null));

    /** In the order of their issue dates, so that their numbers follow the same order. The first one is overdue. */
    private static final List<DemoBill> BILLS = List.of(
            new DemoBill("bill-1", 0, "HW-0118", 40, 30, "Office rent", 1_800),
            new DemoBill("bill-2", 1, "CN-48213", 25, 30, "Team plan, monthly subscription", 290),
            new DemoBill("bill-3", 2, "BP-0457", 12, 30, "Social media campaign", 1_250),
            new DemoBill("bill-4", 3, "MOS-99812", 3, 30, "Ergonomic office chairs", 640));
    private final UserRepository userRepository;
    private final CustomerRepository customerRepository;
    private final InvoiceRepository invoiceRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final SupplierRepository supplierRepository;
    private final BillRepository billRepository;
    private final CustomerService customerService;
    private final InvoiceService invoiceService;
    private final SubscriptionService subscriptionService;
    private final SupplierService supplierService;
    private final BillService billService;

    public DemoDataService(UserRepository userRepository,
                           CustomerRepository customerRepository,
                           InvoiceRepository invoiceRepository,
                           SubscriptionRepository subscriptionRepository,
                           SupplierRepository supplierRepository,
                           BillRepository billRepository,
                           CustomerService customerService,
                           InvoiceService invoiceService,
                           SubscriptionService subscriptionService,
                           SupplierService supplierService,
                           BillService billService) {
        this.userRepository = userRepository;
        this.customerRepository = customerRepository;
        this.invoiceRepository = invoiceRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.supplierRepository = supplierRepository;
        this.billRepository = billRepository;
        this.customerService = customerService;
        this.invoiceService = invoiceService;
        this.subscriptionService = subscriptionService;
        this.supplierService = supplierService;
        this.billService = billService;
    }

    /** Synchronized so that a double click doesn't load the data twice. */
    public synchronized DemoDataResult load(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        String country = user.getCountryCode() != null ? user.getCountryCode() : "NL";
        List<String> warnings = new ArrayList<>();

        List<Customer> customers = new ArrayList<>();
        int customersCreated = 0;
        for (int i = 0; i < CUSTOMERS.size(); i++) {
            DemoCustomer demo = CUSTOMERS.get(i);
            Customer existing = customerRepository.findFirstByUserIdAndDemoKey(userId, demo.key()).orElse(null);
            if (existing != null) {
                customers.add(existing);
            } else {
                customers.add(customerService.create(user, customerRequest(demo, country, i), demo.key()));
                customersCreated++;
            }
        }

        String linksIssue = invoiceService.paymentLinksIssue(user);
        long minorUnits = minorUnits(InvoiceService.currency(user));
        LocalDate today = InvoiceService.today();
        int invoicesCreated = 0;
        int linksCreated = 0;
        int draftsInsteadOfSent = 0;
        for (DemoInvoice demo : INVOICES) {
            if (invoiceRepository.existsByUserIdAndDemoKey(userId, demo.key())) {
                continue;
            }
            LocalDate issueDate = today.minusDays(demo.issuedDaysAgo());
            InvoiceDTO invoice = invoiceService.create(userId, new InvoiceRequest(customers.get(demo.customer()).getId(),
                    issueDate, issueDate.plusDays(demo.termsDays()), demo.notes(), lines(demo, country, minorUnits)), demo.key());
            invoicesCreated++;
            if (demo.send() && linksIssue != null) {
                draftsInsteadOfSent++;
            } else if (demo.send()) {
                try {
                    invoiceService.send(userId, invoice.id());
                    linksCreated++;
                } catch (ApiException e) {
                    log.warn("Demo invoice {} of user {} kept as a draft: {}", invoice.number(), userId, e.getMessage());
                    warnings.add(invoice.number() + " stayed a draft: its payment link was refused"
                            + (e.getError() != null && e.getError().getMessage() != null ? " (" + e.getError().getMessage() + ")" : "")
                            + ".");
                } catch (IOException | RuntimeException e) {
                    log.warn("Demo invoice {} of user {} kept as a draft: {}", invoice.number(), userId, e.getMessage());
                    warnings.add(invoice.number() + " stayed a draft: its payment link couldn't be created.");
                }
            }
            backdate(invoice.id(), issueDate, today);
        }
        if (draftsInsteadOfSent > 0) {
            warnings.add(draftsInsteadOfSent + " invoices stayed drafts instead of being sent. " + linksIssue);
        }

        int subscriptionsCreated = 0;
        if (!subscriptionRepository.existsByUserIdAndDemoKey(userId, SUBSCRIPTION_KEY)) {
            if (linksIssue != null) {
                warnings.add("The demo subscription wasn't created. " + linksIssue);
            } else {
                boolean autoRescue = subscriptionService.autoRescueAvailable();
                try {
                    SubscriptionDTO subscription = subscriptionService.create(userId, new SubscriptionRequest(
                            customers.get(SUBSCRIPTION_CUSTOMER).getId(), SUBSCRIPTION_PLAN, SUBSCRIPTION_PRICE * minorUnits,
                            VatRates.forCountry(country).get(0), "MONTHLY", today, autoRescue, null), SUBSCRIPTION_KEY);
                    subscriptionsCreated++;
                    invoicesCreated++;
                    if (subscription.warning() != null) {
                        warnings.add(subscription.warning());
                    } else {
                        linksCreated++;
                    }
                } catch (RuntimeException e) {
                    log.warn("Demo subscription of user {} not created: {}", userId, e.getMessage());
                    warnings.add("The demo subscription couldn't be created.");
                }
            }
        }

        String currency = InvoiceService.currency(user);
        Map<String, String> bankAccount = testBankAccount(currency, country);
        List<Supplier> suppliers = new ArrayList<>();
        int suppliersCreated = 0;
        for (int i = 0; i < SUPPLIERS.size(); i++) {
            DemoSupplier demo = SUPPLIERS.get(i);
            Supplier existing = supplierRepository.findFirstByUserIdAndDemoKey(userId, demo.key()).orElse(null);
            if (existing != null) {
                suppliers.add(existing);
            } else {
                suppliers.add(supplierService.create(user, supplierRequest(demo, country, i, bankAccount), demo.key()));
                suppliersCreated++;
            }
        }
        if (suppliersCreated > 0 && bankAccount == null) {
            warnings.add("The suppliers have no bank details: transfers aren't available from a " + currency
                    + " account, so their bills can only be paid by card.");
        }
        BigDecimal standardRate = VatRates.forCountry(country).get(0);
        int billsCreated = 0;
        for (DemoBill demo : BILLS) {
            if (billRepository.existsByUserIdAndDemoKey(userId, demo.key())) {
                continue;
            }
            LocalDate issueDate = today.minusDays(demo.issuedDaysAgo());
            BillDTO bill = billService.create(userId, new BillRequest(suppliers.get(demo.supplier()).getId(),
                    demo.supplierReference(), issueDate, issueDate.plusDays(demo.termsDays()), demo.description(),
                    demo.subtotal() * minorUnits, standardRate, null), demo.key());
            billsCreated++;
            backdateBill(bill.id(), issueDate, today);
        }
        log.info("Demo data of user {}: {} customers, {} invoices, {} payment links, {} subscriptions, {} suppliers and {}"
                        + " bills created", userId, customersCreated, invoicesCreated, linksCreated, subscriptionsCreated,
                suppliersCreated, billsCreated);
        return new DemoDataResult(customersCreated, invoicesCreated, linksCreated, subscriptionsCreated, suppliersCreated,
                billsCreated, warnings);
    }
    private static CustomerRequest customerRequest(DemoCustomer demo, String country, int index) {
        List<Address> addresses = ADDRESSES.get(country);
        Address address = addresses != null ? addresses.get(index % addresses.size()) : null;
        return new CustomerRequest(demo.name(), demo.company(), demo.email(), country, vatNumber(country, index),
                address != null ? address.line() : null,
                address != null ? address.postalCode() : null,
                address != null ? address.city() : null);
    }

    private static SupplierRequest supplierRequest(DemoSupplier demo, String country, int index,
                                                   Map<String, String> bankAccount) {
        Map<String, String> bank = demo.byTransfer() && bankAccount != null ? bankAccount : Map.of();
        return new SupplierRequest(demo.name(), demo.email(), country, vatNumber(country, index + CUSTOMERS.size()),
                bank.get("iban"), bank.get("accountNumber"), bank.get("sortCode"), bank.get("routingNumber"),
                demo.category(), demo.vopScenario());
    }

    /**
     * Bank details the TEST environment accepts for a transfer from an account in this currency: in the user's country
     * when it has some. Null when transfers aren't available from such an account.
     */
    private static Map<String, String> testBankAccount(String currency, String country) {
        return Stream.concat(Stream.of(country, "NL", "DE", "FR")
                                .map(code -> RecipientCountries.find(currency, code).orElse(null))
                                .filter(Objects::nonNull),
                        RecipientCountries.forAccountCurrency(currency).stream())
                .map(RecipientCountry::getTestAccount)
                .filter(Objects::nonNull)
                .findFirst()
                .orElse(null);
    }

    /** A VAT number in the format of the country, null where businesses don't have one. */
    private static String vatNumber(String country, int index) {
        String serial = SERIALS.get(index % SERIALS.size());
        return switch (country) {
            case "US", "CA", "AU", "NZ", "SG", "JP", "HK" -> null;
            case "AT" -> "ATU" + serial.substring(1);
            case "BE" -> "BE0" + serial;
            case "ES" -> "ESB" + serial.substring(1);
            case "FR" -> "FR" + (40 + index * 13) + serial;
            case "IT" -> "IT" + serial + "01";
            case "NL" -> "NL" + serial + "B01";
            default -> country + serial;
        };
    }

    private static List<InvoiceRequest.Line> lines(DemoInvoice demo, String country, long minorUnits) {
        BigDecimal standard = VatRates.forCountry(country).get(0);
        BigDecimal books = BOOKS_RATE.containsKey(country) ? new BigDecimal(BOOKS_RATE.get(country)) : standard;
        return demo.lines().stream()
                .map(line -> new InvoiceRequest.Line(line.description(), line.quantity(), line.unitPrice() * minorUnits,
                        line.books() ? books : standard))
                .toList();
    }

    /** How many minor units make a major unit of the currency: 100 for EUR. */
    private static long minorUnits(String currency) {
        int digits;
        try {
            digits = Currency.getInstance(currency).getDefaultFractionDigits();
        } catch (IllegalArgumentException e) {
            digits = 2;
        }
        long units = 1;
        for (int i = 0; i < Math.max(digits, 0); i++) {
            units *= 10;
        }
        return units;
    }

    /** Dates the creation and the sending of an invoice issued in the past on its issue date. */
    private void backdate(Long invoiceId, LocalDate issueDate, LocalDate today) {
        if (!issueDate.isBefore(today)) {
            return;
        }
        invoiceRepository.findById(invoiceId).ifPresent(invoice -> {
            Instant created = issueDate.atTime(9, 0).toInstant(ZoneOffset.UTC);
            Instant sent = created.plus(Duration.ofMinutes(5));
            invoice.setCreatedAt(created);
            if (invoice.getSentAt() != null) {
                invoice.setSentAt(sent);
            }
            for (InvoiceEvent event : invoice.getEvents()) {
                if (event.getType() == InvoiceEvent.Type.CREATED) {
                    event.setOccurredAt(created);
                } else if (event.getType() == InvoiceEvent.Type.SENT) {
                    event.setOccurredAt(sent);
                }
            }
            invoiceRepository.save(invoice);
        });
    }

    /** Dates the recording of a bill received in the past on its issue date. */
    private void backdateBill(Long billId, LocalDate issueDate, LocalDate today) {
        if (!issueDate.isBefore(today)) {
            return;
        }
        billRepository.findById(billId).ifPresent(bill -> {
            Instant recorded = issueDate.atTime(9, 0).toInstant(ZoneOffset.UTC);
            bill.setCreatedAt(recorded);
            for (BillEvent event : bill.getEvents()) {
                if (event.getType() == BillEvent.Type.CREATED) {
                    event.setOccurredAt(recorded);
                }
            }
            billRepository.save(bill);
        });
    }
}
