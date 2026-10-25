import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";
import type { PontoPvbt } from "../../tipos/banco";
import { fmt, fmtExato } from "../../utils/formatacao";
import { escalaLog, formatarLog } from "../charts/escalaLog";

export type VisaoComparacao = "barras" | "velocidade";

// uma cor por amostra (a mesma sequência do padrão Origin usado nos gráficos do backend)
const CORES = ["#0000FF", "#FF0000", "#008000", "#FF00FF", "#808000", "#000080", "#800080", "#008080", "#800000", "#000000"];
const MARCADORES = ["circle", "square", "triangle", "diamond", "cross", "star", "wye"] as const;
const TEXTO = "var(--grafico-texto)";

const rotuloEnsaio = (e: PontoPvbt) =>
  [e.id_experimento, e.temperatura_nominal_c != null ? `${fmt(e.temperatura_nominal_c, 0)} °C` : null,
    e.vazao_ml_min != null ? `${fmt(e.vazao_ml_min, 2)} mL/min` : null].filter(Boolean).join(" · ");

export interface ExportarComparacao { baixar: (formato: "png" | "svg", nome: string) => Promise<void> }

/** Gráfico de PVbt para comparar amostras, desenhado no navegador (sem custo no servidor). */
export const GraficoComparacao = forwardRef<ExportarComparacao, { ensaios: PontoPvbt[]; visao: VisaoComparacao }>(function GraficoComparacao(p, ref) {
  const caixa = useRef<HTMLDivElement>(null);

  // cor de cada amostra, estável pela ordem dos códigos
  const codigos = useMemo(() => [...new Set(p.ensaios.map((e) => e.id_amostra))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })), [p.ensaios]);
  const cor = (cod: string) => CORES[codigos.indexOf(cod) % CORES.length];

  const barras = useMemo(() => [...p.ensaios]
    .sort((a, b) => a.id_amostra.localeCompare(b.id_amostra, "pt-BR", { numeric: true }) || a.id_experimento.localeCompare(b.id_experimento, "pt-BR", { numeric: true }))
    .map((e) => ({ nome: `${e.id_amostra} · ${e.id_experimento}`, amostra: e.id_amostra, pvbt: Number(e.pvbt), detalhe: rotuloEnsaio(e) })), [p.ensaios]);

  const pontos = useMemo(() => p.ensaios
    .filter((e) => (e.vel_intersticial_cm_min ?? 0) > 0 && (e.pvbt ?? 0) > 0)
    .map((e) => ({ x: Number(e.vel_intersticial_cm_min), y: Number(e.pvbt), amostra: e.id_amostra, detalhe: rotuloEnsaio(e) })), [p.ensaios]);
  const ex = escalaLog(pontos.map((d) => d.x));
  const ey = escalaLog(pontos.map((d) => d.y));

  useImperativeHandle(ref, () => ({
    async baixar(formato, nome) {
      const svg = caixa.current?.querySelector<SVGSVGElement>("svg.recharts-surface");
      if (!svg) return;
      const { width, height } = svg.getBoundingClientRect();
      const copia = svg.cloneNode(true) as SVGSVGElement;
      copia.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      copia.setAttribute("width", String(width));
      copia.setAttribute("height", String(height));
      copia.setAttribute("viewBox", `0 0 ${width} ${height}`);
      copia.style.fontFamily = "Arial, Helvetica, sans-serif";
      // as cores do tema viram valores fixos, senão o arquivo exportado perde texto e grade
      const estilo = getComputedStyle(document.documentElement);
      let xml = new XMLSerializer().serializeToString(copia);
      xml = xml.replace(/var\((--[a-z0-9-]+)\)/gi, (_, v: string) => estilo.getPropertyValue(v).trim() || "#333");
      const fundo = `<rect width="100%" height="100%" fill="#ffffff"/>`;
      xml = xml.replace(/(<svg[^>]*>)/, `$1${fundo}`);
      const salvar = (blob: Blob, ext: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${nome}.${ext}`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      if (formato === "svg") { salvar(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }), "svg"); return; }
      const escala = 3;
      const img = new Image();
      await new Promise<void>((ok, erro) => { img.onload = () => ok(); img.onerror = () => erro(new Error("Não consegui gerar a imagem.")); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`; });
      const tela = document.createElement("canvas");
      tela.width = width * escala; tela.height = height * escala;
      const c = tela.getContext("2d")!;
      c.scale(escala, escala); c.drawImage(img, 0, 0, width, height);
      const png = await new Promise<Blob | null>((ok) => tela.toBlob(ok, "image/png"));
      if (png) salvar(png, "png");
    },
  }), []);

  if (p.visao === "barras") {
    const altura = Math.max(300, 90 + barras.length * 38);
    return (
      <div ref={caixa}>
        <ResponsiveContainer width="100%" height={altura}>
          <BarChart data={barras} layout="vertical" margin={{ top: 8, right: 64, bottom: 28, left: 8 }} barCategoryGap="22%">
            <CartesianGrid stroke="var(--grafico-grade)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11, fill: TEXTO }} stroke="var(--color-neutral-400)"
              tickFormatter={(v: number) => v.toLocaleString("pt-BR", { maximumSignificantDigits: 3 })}
              label={{ value: "PVbt (PV)", position: "insideBottom", offset: -14, fontSize: 12, fill: TEXTO, fontWeight: 700 }} />
            <YAxis type="category" dataKey="nome" width={170} tick={{ fontSize: 11, fill: TEXTO }} stroke="var(--color-neutral-400)" interval={0} />
            <Tooltip cursor={{ fill: "var(--color-blue-50)" }} content={({ active, payload }) => {
              const d = active ? (payload?.[0]?.payload as (typeof barras)[number] | undefined) : undefined;
              return d ? (
                <div className="rounded-md border border-[var(--color-neutral-300)] bg-white px-3 py-2 text-[12px] shadow-md">
                  <p className="m-0 font-bold" style={{ color: cor(d.amostra) }}>{d.nome}</p>
                  <p className="m-0 text-[var(--color-neutral-600)]">{d.detalhe}</p>
                  <p className="m-0 tabular-nums">PVbt = <strong>{fmtExato(d.pvbt)}</strong></p>
                </div>
              ) : null;
            }} />
            <Bar dataKey="pvbt" radius={[0, 5, 5, 0]} isAnimationActive={false}>
              {barras.map((d) => <Cell key={d.nome} fill={cor(d.amostra)} />)}
              <LabelList dataKey="pvbt" position="right" fontSize={11} fill={TEXTO} formatter={(v: unknown) => fmt(v, 4)} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (!pontos.length) {
    return (
      <p className="m-0 py-16 text-center text-[13px] text-[var(--color-neutral-600)]">
        Nenhum ensaio escolhido tem velocidade intersticial (falta a porosidade da amostra). Use a visão "Por amostra".
      </p>
    );
  }
  const amostrasComPonto = codigos.filter((c) => pontos.some((d) => d.amostra === c));
  return (
    <div ref={caixa}>
      <ResponsiveContainer width="100%" height={440}>
        <ScatterChart margin={{ top: 12, right: 28, bottom: 32, left: 12 }}>
          <CartesianGrid stroke="var(--grafico-grade)" strokeDasharray="3 3" />
          <XAxis dataKey="x" type="number" scale="log" domain={ex.dominio} ticks={ex.marcas} tickFormatter={formatarLog} allowDataOverflow
            tick={{ fontSize: 11, fill: TEXTO }} stroke="var(--color-neutral-400)"
            label={{ value: "Velocidade intersticial (cm/min)", position: "insideBottom", offset: -16, fontSize: 12, fill: TEXTO, fontWeight: 700 }} />
          <YAxis dataKey="y" type="number" scale="log" domain={ey.dominio} ticks={ey.marcas} tickFormatter={formatarLog} width={62} allowDataOverflow
            tick={{ fontSize: 11, fill: TEXTO }} stroke="var(--color-neutral-400)"
            label={{ value: "PVbt (PV)", angle: -90, position: "insideLeft", fontSize: 12, fill: TEXTO, fontWeight: 700, style: { textAnchor: "middle" } }} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
            const d = active ? (payload?.[0]?.payload as (typeof pontos)[number] | undefined) : undefined;
            return d ? (
              <div className="rounded-md border border-[var(--color-neutral-300)] bg-white px-3 py-2 text-[12px] shadow-md">
                <p className="m-0 font-bold" style={{ color: cor(d.amostra) }}>{d.amostra}</p>
                <p className="m-0 text-[var(--color-neutral-600)]">{d.detalhe}</p>
                <p className="m-0 tabular-nums">v = {fmt(d.x, 4)} cm/min</p>
                <p className="m-0 tabular-nums">PVbt = <strong>{fmtExato(d.y)}</strong></p>
              </div>
            ) : null;
          }} />
          <Legend verticalAlign="top" height={32} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          {amostrasComPonto.map((cod, i) => (
            <Scatter key={cod} name={cod} data={pontos.filter((d) => d.amostra === cod).sort((a, b) => a.x - b.x)}
              fill={cor(cod)} stroke={cor(cod)} line={{ strokeWidth: 1.5 }} shape={MARCADORES[i % MARCADORES.length]} isAnimationActive={false} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
});
