package com.myplatform.demo.service;

import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.kernel.pdf.xobject.PdfFormXObject;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.element.Image;
import com.itextpdf.layout.element.Paragraph;
import com.itextpdf.layout.element.Table;
import com.itextpdf.svg.converter.SvgConverter;
import lombok.Getter;
import lombok.Setter;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;


@Service
public class RibPdfGeneratorService {

    private static final String ADYEN_BIC = "ADYBNL2AXXX";
    private static final String LOGO_PATH = "/Adyen_Corporate_Logo.svg";

    public byte[] generatePdf(String iban, String nomTitulaire) throws Exception {

        String cleanIban = iban.replaceAll("\\s+", "");

        if (!cleanIban.startsWith("FR") || cleanIban.length() != 27) {
            throw new IllegalArgumentException("IBAN français invalide");
        }

        RibData rib = extractRibFromIban(cleanIban);

        ByteArrayOutputStream baos = new ByteArrayOutputStream();

        PdfWriter writer = new PdfWriter(baos);
        PdfDocument pdf = new PdfDocument(writer);
        Document document = new Document(pdf);

        try (InputStream logoStream = getClass().getResourceAsStream(LOGO_PATH)) {
            if (logoStream != null) {
                PdfFormXObject xObject = SvgConverter.convertToXObject(logoStream, pdf);
                Image logo = new Image(xObject);

                logo.scaleToFit(150, 50);
                document.add(logo);
            } else {
                System.err.println("Avertissement : Fichier " + LOGO_PATH + " introuvable dans les resources.");
            }
        } catch (Exception e) {
            System.err.println("Avertissement : Erreur lors de l'intégration du logo SVG : " + e.getMessage());
        }

        document.add(new Paragraph("RELEVÉ D'IDENTITÉ BANCAIRE (RIB)").setBold().setFontSize(16));
        document.add(new Paragraph("\n"));

        if (nomTitulaire != null && !nomTitulaire.trim().isEmpty()) {
            document.add(new Paragraph("Titulaire du compte : " + nomTitulaire).setBold().setFontSize(12));
            document.add(new Paragraph("\n"));
        }

        Table table = getTable(nomTitulaire, cleanIban, rib);

        document.add(table);
        document.close();

        return baos.toByteArray();
    }

    private Table getTable(String nomTitulaire, String cleanIban, RibData rib) {
        String formattedIban = formatIban(cleanIban);

        Table table = new Table(2);

        table.addCell("Titulaire");
        table.addCell(nomTitulaire != null ? nomTitulaire : "");

        table.addCell("IBAN");
        table.addCell(formattedIban);

        table.addCell("BIC");
        table.addCell(ADYEN_BIC);

        table.addCell("Code Banque");
        table.addCell(rib.getCodeBanque());

        table.addCell("Code Guichet");
        table.addCell(rib.getCodeGuichet());

        table.addCell("Numéro de compte");
        table.addCell(rib.getNumeroCompte());

        table.addCell("Clé RIB");
        table.addCell(rib.getCleRib());
        return table;
    }

    private RibData extractRibFromIban(String iban) {
        String cleanIban = iban.replaceAll("\\s+", "");

        if (!cleanIban.startsWith("FR") || cleanIban.length() != 27) {
            throw new IllegalArgumentException("IBAN français invalide");
        }

        return new RibData(
                cleanIban.substring(4, 9),
                cleanIban.substring(9, 14),
                cleanIban.substring(14, 25),
                cleanIban.substring(25, 27)
        );
    }

    private String formatIban(String iban) {
        return iban.replaceAll(".{4}(?!$)", "$0 ");
    }

    @Getter
    @Setter
    static class RibData {
        String codeBanque;
        String codeGuichet;
        String numeroCompte;
        String cleRib;

        public RibData(String codeBanque, String codeGuichet, String numeroCompte, String cleRib) {
            this.codeBanque = codeBanque;
            this.codeGuichet = codeGuichet;
            this.numeroCompte = numeroCompte;
            this.cleRib = cleRib;
        }
    }
}