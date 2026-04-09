import type { NotaHeader } from "@/lib/notaHeader";

export type ItemTicket = {
  descricao: string;
  unidade: string;
  quantidade_total: number;
  quantidade_entregue: number;
};

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Abre a caixa de impressão com o ticket (sem nova janela — usa iframe oculto
 * para não ser bloqueado como pop-up).
 */
export function imprimirTicketEntregas(opts: {
  notaHeader: NotaHeader;
  itens: ItemTicket[];
  atendenteLabel: string;
}) {
  const { notaHeader, itens, atendenteLabel } = opts;
  const entregues = itens.filter((i) => i.quantidade_entregue > 0);
  const agora = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  const linhas =
    entregues.length === 0
      ? `<tr><td colspan="3" style="padding:8px;font-style:italic">Nenhuma quantidade entregue registrada ainda.</td></tr>`
      : entregues
          .map(
            (it, idx) => `
    <tr>
      <td style="padding:4px 6px;border-bottom:1px solid #ddd;vertical-align:top">${idx + 1}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #ddd">${esc(it.descricao)}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #ddd;text-align:right;white-space:nowrap">${esc(String(it.quantidade_entregue))} ${esc(it.unidade || "UN")} / ${esc(String(it.quantidade_total))}</td>
    </tr>`,
          )
          .join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Ticket de entrega</title>
  <style>
    @media print {
      body { margin: 0; padding: 8mm; }
      .no-print { display: none !important; }
    }
    body { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: #111; max-width: 80mm; margin: 0 auto; padding: 12px; }
    h1 { font-size: 14px; margin: 0 0 8px; text-align: center; }
    .muted { color: #444; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { text-align: left; font-size: 10px; border-bottom: 2px solid #009739; padding: 4px 6px; }
    .chave { word-break: break-all; font-size: 9px; }
  </style>
</head>
<body>
  <h1>Ticket de itens entregues</h1>
  <p class="muted">Emitido em ${esc(agora)} (America/São Paulo)</p>
  <p><strong>Atendente:</strong> ${esc(atendenteLabel || "—")}</p>
  <hr style="border:none;border-top:1px dashed #ccc;margin:8px 0" />
  <p><strong>Cliente:</strong> ${esc(notaHeader.cliente_nome ?? "—")}</p>
  <p class="muted">NFe ${esc(notaHeader.numero ?? "—")}${notaHeader.serie ? ` / Série ${esc(notaHeader.serie)}` : ""}</p>
  <p class="chave muted">Chave: ${esc(notaHeader.chave_acesso)}</p>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Descrição</th>
        <th style="text-align:right">Entregue</th>
      </tr>
    </thead>
    <tbody>${linhas}</tbody>
  </table>
  <p class="muted" style="margin-top:12px;text-align:center">Copagril — conferência de retirada</p>
</body>
</html>`;

  if (typeof document === "undefined") return false;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.title = "Ticket de entrega";
  iframe.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:800px",
    "height:1200px",
    "border:0",
    "opacity:0",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");

  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument ?? win?.document;
  if (!win || !doc) {
    iframe.remove();
    return false;
  }

  doc.open();
  doc.write(html);
  doc.close();

  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    if (fallbackTimer != null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    iframe.remove();
  };

  const doPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
    }
  };

  win.addEventListener("afterprint", cleanup, { once: true });
  fallbackTimer = setTimeout(cleanup, 120_000);

  if (typeof win.requestAnimationFrame === "function") {
    win.requestAnimationFrame(doPrint);
  } else {
    setTimeout(doPrint, 0);
  }

  return true;
}
