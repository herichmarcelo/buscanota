import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { extractHeaderFromNota, fmtDt, type NotaHeader } from "@/lib/notaHeader";

export type ItemRelatorioPdf = {
  descricao: string;
  unidade: string;
  quantidade_total: number;
  quantidade_entregue: number;
  saldo_restante: number;
  status: string;
  ultima_retirada_em?: string | null;
};

function diaPtBr(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split("-");
  if (!y || !m || !d) return yyyyMmDd;
  return `${d}/${m}/${y}`;
}

export function downloadPdfRelatorioEntregasDia(opts: {
  notaCapa: any;
  dia: string;
  itens: ItemRelatorioPdf[];
  geradoEmIso: string;
}) {
  const { notaCapa, dia, itens, geradoEmIso } = opts;
  const header: NotaHeader = extractHeaderFromNota(notaCapa);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Relatório de entregas do dia", 14, 18);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  let y = 26;
  doc.text(`Data do relatório: ${diaPtBr(dia)}`, 14, y);
  y += 5;
  doc.text(`Gerado em: ${fmtDt(geradoEmIso) ?? geradoEmIso}`, 14, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text("Nota fiscal", 14, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.text(`Chave de acesso: ${header.chave_acesso}`, 14, y);
  y += 5;
  if (header.cliente_nome) {
    doc.text(`Cliente: ${header.cliente_nome}`, 14, y);
    y += 5;
  }
  if (header.cliente_doc) {
    doc.text(`Documento: ${header.cliente_doc}`, 14, y);
    y += 5;
  }
  if (header.numero) {
    doc.text(
      `NFe ${header.numero}${header.serie ? ` / Série ${header.serie}` : ""}`,
      14,
      y,
    );
    y += 5;
  }
  y += 3;

  const head = [
    [
      "#",
      "Descrição",
      "Un.",
      "Qtd total",
      "Entregue",
      "Saldo",
      "Status",
      "Última retirada",
    ],
  ];

  const tableOpts = {
    startY: y,
    head,
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [0, 151, 57] as [number, number, number], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 52 },
      2: { cellWidth: 12 },
      3: { cellWidth: 18 },
      4: { cellWidth: 18 },
      5: { cellWidth: 16 },
      6: { cellWidth: 18 },
      7: { cellWidth: 28 },
    },
    margin: { left: 14, right: 14 },
  };

  if (itens.length === 0) {
    autoTable(doc, {
      ...tableOpts,
      body: [
        [
          {
            content:
              "Nenhum item com retirada registrada neste dia (horário America/São Paulo). Itens só aparecem se houver alteração de entrega com data de última retirada neste dia.",
            colSpan: 8,
            styles: { fontStyle: "italic" as const, textColor: 100 },
          },
        ],
      ],
    });
  } else {
    const body = itens.map((it, idx) => [
      String(idx + 1),
      it.descricao,
      it.unidade || "—",
      String(it.quantidade_total),
      String(it.quantidade_entregue),
      String(it.saldo_restante),
      it.status,
      it.ultima_retirada_em
        ? fmtDt(it.ultima_retirada_em) ?? it.ultima_retirada_em
        : "—",
    ]);
    autoTable(doc, { ...tableOpts, body });
  }

  const safeName = `entregas-${header.chave_acesso.slice(0, 8)}-${dia}.pdf`;
  doc.save(safeName);
}

/** PDF com todos os itens no momento do fechamento (conferência posterior). */
export function downloadPdfRelatorioFechamento(opts: {
  capa: NotaHeader;
  itens: ItemRelatorioPdf[];
  fechadoEmIso: string;
  geradoEmIso: string;
}) {
  const { capa, itens, fechadoEmIso, geradoEmIso } = opts;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Fechamento de entrega (conferência)", 14, 18);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  let y = 26;
  doc.text(`Fechado em: ${fmtDt(fechadoEmIso) ?? fechadoEmIso}`, 14, y);
  y += 5;
  doc.text(`Gerado em: ${fmtDt(geradoEmIso) ?? geradoEmIso}`, 14, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text("Nota fiscal", 14, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.text(`Chave de acesso: ${capa.chave_acesso}`, 14, y);
  y += 5;
  if (capa.cliente_nome) {
    doc.text(`Cliente: ${capa.cliente_nome}`, 14, y);
    y += 5;
  }
  if (capa.cliente_doc) {
    doc.text(`Documento: ${capa.cliente_doc}`, 14, y);
    y += 5;
  }
  if (capa.numero) {
    doc.text(
      `NFe ${capa.numero}${capa.serie ? ` / Série ${capa.serie}` : ""}`,
      14,
      y,
    );
    y += 5;
  }
  y += 3;

  const head = [
    [
      "#",
      "Descrição",
      "Un.",
      "Qtd total",
      "Entregue",
      "Saldo",
      "Status",
      "Última retirada",
    ],
  ];

  const tableOpts = {
    startY: y,
    head,
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [0, 92, 46] as [number, number, number], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 52 },
      2: { cellWidth: 12 },
      3: { cellWidth: 18 },
      4: { cellWidth: 18 },
      5: { cellWidth: 16 },
      6: { cellWidth: 18 },
      7: { cellWidth: 28 },
    },
    margin: { left: 14, right: 14 },
  };

  if (itens.length === 0) {
    autoTable(doc, {
      ...tableOpts,
      body: [
        [
          {
            content:
              "Nenhum item na nota neste fechamento (verifique os dados no sistema).",
            colSpan: 8,
            styles: { fontStyle: "italic" as const, textColor: 100 },
          },
        ],
      ],
    });
  } else {
    const body = itens.map((it, idx) => [
      String(idx + 1),
      it.descricao,
      it.unidade || "—",
      String(it.quantidade_total),
      String(it.quantidade_entregue),
      String(it.saldo_restante),
      it.status,
      it.ultima_retirada_em
        ? fmtDt(it.ultima_retirada_em) ?? it.ultima_retirada_em
        : "—",
    ]);
    autoTable(doc, { ...tableOpts, body });
  }

  const safeName = `fechamento-${capa.chave_acesso.slice(0, 8)}.pdf`;
  doc.save(safeName);
}
