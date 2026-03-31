package com.myplatform.demo.service;

import com.itextpdf.io.source.ByteArrayOutputStream;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.element.Paragraph;
import com.itextpdf.layout.element.Table;
import lombok.Getter;
import lombok.Setter;
import org.springframework.stereotype.Service;

@Service
public class RibPdfGeneratorService {
    public byte[] generatePdf(String iban) throws Exception {

        iban = iban.replaceAll("\\s+", "");

        if (!iban.startsWith("FR") || iban.length() != 27) {
            throw new IllegalArgumentException("IBAN français invalide");
        }

        RibData rib = extractRibFromIban(iban);

        ByteArrayOutputStream baos = new ByteArrayOutputStream();

        PdfWriter writer = new PdfWriter(baos);
        PdfDocument pdf = new PdfDocument(writer);
        Document document = new Document(pdf);

        document.add(new Paragraph("RELEVÉ D'IDENTITÉ BANCAIRE (RIB)").setBold().setFontSize(16));
        document.add(new Paragraph("\n"));

        Table table = new Table(2);

        table.addCell("IBAN");
        table.addCell(iban);

        table.addCell("Code Banque");
        table.addCell(rib.getCodeBanque());

        table.addCell("Code Guichet");
        table.addCell(rib.getCodeGuichet());

        table.addCell("Numéro de compte");
        table.addCell(rib.getNumeroCompte());

        table.addCell("Clé RIB");
        table.addCell(rib.getCleRib());

        document.add(table);
        document.close();

        return baos.toByteArray();
    }

    private RibData extractRibFromIban(String iban) {
        iban = iban.replaceAll("\\s+", "");

        if (!iban.startsWith("FR") || iban.length() != 27) {
            throw new IllegalArgumentException("IBAN français invalide");
        }

        return new RibData(
                iban.substring(4, 9),
                iban.substring(9, 14),
                iban.substring(14, 25),
                iban.substring(25, 27)
        );
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
