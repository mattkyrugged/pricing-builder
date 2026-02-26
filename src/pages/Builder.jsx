import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useToast } from '../App';

const DEFAULT_CONFIG = {
  companyName: 'KENTUCKY RUGGED TECHNOLOGY SOLUTIONS',
  title: 'PARTNER PRICING REFERENCE SHEET',
  subtitle: 'Authorized Panasonic Toughbook Dealer',
  badge: 'AUTHORIZED PARTNER',
  primaryColor: '#0F1A2E',
  accentColor: '#C9A96E',
  headerBg: '#1B2D4F',
  commissionColor: '#1A7A2E',
  governanceStatement: 'Pricing, availability, and terms subject to change. All sales governed by Kentucky Rugged Technology Solutions terms and conditions.',
  footerText: 'Kentucky Rugged Technology Solutions · kyrugged.com · Lawrenceburg, KY',
  showFormula: true,
  showGovernance: true,
  sections: [],
};

const EMPTY_ITEM = { sku: '', name: '', price: 0, commission: 0 };

export default function Builder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [sheetName, setSheetName] = useState('New Partner Sheet');
  const [config, setConfig] = useState({ ...DEFAULT_CONFIG });
  const [activeTab, setActiveTab] = useState('sections');
  const [expandedSections, setExpandedSections] = useState({});
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const [loaded, setLoaded] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [showCatalogPicker, setShowCatalogPicker] = useState(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [viewMode, setViewMode] = useState('edit'); // 'edit' | 'preview'
  const importFileRef = useRef();
  const sheetIdRef = useRef(id || null);
  const saveTimerRef = useRef(null);
  const latestDataRef = useRef({ sheetName: 'New Partner Sheet', config: { ...DEFAULT_CONFIG } });
  const hasPendingChanges = useRef(false);

  // Keep latestDataRef in sync so unmount save has current data
  useEffect(() => {
    latestDataRef.current = { sheetName, config };
  }, [sheetName, config]);

  // On mount: load existing sheet OR create a new one immediately
  useEffect(() => {
    if (id) {
      sheetIdRef.current = id;
      loadSheet(id);
    } else {
      createNewSheet();
    }
    loadCatalog();

    // On unmount: flush any pending save
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (hasPendingChanges.current && sheetIdRef.current) {
        const { sheetName: name, config: cfg } = latestDataRef.current;
        // Fire-and-forget save on unmount
        supabase.from('sheets').update({
          name, config: cfg, updated_at: new Date().toISOString()
        }).eq('id', sheetIdRef.current).then(() => {});
      }
    };
  }, []);

  // Auto-save on changes (debounced 1s)
  useEffect(() => {
    if (!loaded) return;

    hasPendingChanges.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('idle');

    saveTimerRef.current = setTimeout(() => {
      saveToSupabase();
    }, 1000);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [sheetName, config, loaded]);

  async function createNewSheet() {
    try {
      const { data, error } = await supabase.from('sheets').insert({
        name: 'New Partner Sheet', config: { ...DEFAULT_CONFIG }
      }).select().single();
      if (error) throw error;
      sheetIdRef.current = data.id;
      navigate(`/builder/${data.id}`, { replace: true });
      setLoaded(true);
      setSaveStatus('saved');
    } catch (err) {
      console.error('Failed to create sheet:', err);
      toast('Failed to create sheet', 'error');
      setLoaded(true); // still let them edit
    }
  }

  async function saveToSupabase() {
    if (!sheetIdRef.current) return;
    setSaveStatus('saving');
    try {
      const { error } = await supabase.from('sheets').update({
        name: sheetName, config, updated_at: new Date().toISOString()
      }).eq('id', sheetIdRef.current);
      if (error) throw error;
      setSaveStatus('saved');
      hasPendingChanges.current = false;
    } catch (err) {
      setSaveStatus('error');
      console.error('Auto-save failed:', err);
    }
  }

  async function loadSheet(sheetId) {
    const { data, error } = await supabase.from('sheets').select('*').eq('id', sheetId).single();
    if (error || !data) { toast('Sheet not found', 'error'); navigate('/'); return; }
    setSheetName(data.name);
    setConfig({ ...DEFAULT_CONFIG, ...data.config });
    setLoaded(true);
    setSaveStatus('saved');
  }

  async function loadCatalog() {
    const { data } = await supabase.from('products').select('*').order('category').order('name');
    if (data) setCatalogProducts(data);
  }

  function updateConfig(key, value) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  function addSection() {
    const sections = [...config.sections, { title: 'New Section', subtitle: '', items: [{ ...EMPTY_ITEM }] }];
    updateConfig('sections', sections);
    setExpandedSections(prev => ({ ...prev, [sections.length - 1]: true }));
  }

  function removeSection(idx) {
    const sections = config.sections.filter((_, i) => i !== idx);
    updateConfig('sections', sections);
  }

  function updateSection(idx, key, value) {
    const sections = [...config.sections];
    sections[idx] = { ...sections[idx], [key]: value };
    updateConfig('sections', sections);
  }

  function moveSection(idx, dir) {
    const sections = [...config.sections];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= sections.length) return;
    [sections[idx], sections[newIdx]] = [sections[newIdx], sections[idx]];
    updateConfig('sections', sections);
  }

  function addItem(sectionIdx) {
    const sections = [...config.sections];
    sections[sectionIdx].items.push({ ...EMPTY_ITEM });
    updateConfig('sections', sections);
  }

  function removeItem(sectionIdx, itemIdx) {
    const sections = [...config.sections];
    sections[sectionIdx].items = sections[sectionIdx].items.filter((_, i) => i !== itemIdx);
    updateConfig('sections', sections);
  }

  function updateItem(sectionIdx, itemIdx, key, value) {
    const sections = [...config.sections];
    sections[sectionIdx].items[itemIdx] = { ...sections[sectionIdx].items[itemIdx], [key]: value };
    updateConfig('sections', sections);
  }

  function addFromCatalog(sectionIdx, product) {
    const sections = [...config.sections];
    sections[sectionIdx].items.push({
      sku: product.sku,
      name: product.name,
      price: +product.price,
      commission: +product.commission,
    });
    updateConfig('sections', sections);
    toast(`Added ${product.sku}`);
  }

  function addAllCategoryProducts(sectionIdx, category) {
    const prods = catalogProducts.filter(p => p.category === category);
    if (prods.length === 0) { toast('No products in this category', 'error'); return; }
    const sections = [...config.sections];
    const newItems = prods.map(p => ({ sku: p.sku, name: p.name, price: +p.price, commission: +p.commission }));
    sections[sectionIdx].items = [...sections[sectionIdx].items.filter(i => i.sku || i.name), ...newItems];
    updateConfig('sections', sections);
    toast(`Added ${prods.length} products`);
    setShowCatalogPicker(null);
  }

  function exportPDF() {
    const html = generatePrintHTML();
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  }

  function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sections = [];

        // Check if it's a multi-tab Excel (like the KY Rugged sheet)
        if (workbook.SheetNames.length > 1) {
          // Multi-tab: each tab becomes a section
          for (const sheetName of workbook.SheetNames) {
            const ws = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            if (rows.length === 0) continue;

            const items = parseRows(rows);
            if (items.length > 0) {
              sections.push({ title: sheetName, subtitle: '', items });
            }
          }
        } else {
          // Single sheet: group by category column if present, otherwise one section
          const ws = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

          // Check if there's a category/section column
          const headers = Object.keys(rows[0] || {}).map(h => h.toLowerCase());
          const catKey = Object.keys(rows[0] || {}).find(k =>
            /category|section|group|type/i.test(k)
          );

          if (catKey) {
            // Group rows by category
            const groups = {};
            for (const row of rows) {
              const cat = String(row[catKey] || 'Other').trim();
              if (!groups[cat]) groups[cat] = [];
              groups[cat].push(row);
            }
            for (const [cat, catRows] of Object.entries(groups)) {
              const items = parseRows(catRows);
              if (items.length > 0) {
                sections.push({ title: cat, subtitle: '', items });
              }
            }
          } else {
            // No categories, single section
            const items = parseRows(rows);
            if (items.length > 0) {
              sections.push({ title: file.name.replace(/\.[^.]+$/, ''), subtitle: '', items });
            }
          }
        }

        if (sections.length === 0) {
          toast('No valid data found in file', 'error');
          return;
        }

        // Ask whether to replace or append
        const shouldReplace = config.sections.length === 0 ||
          confirm(`Replace existing ${config.sections.length} sections? (Cancel to append instead)`);

        if (shouldReplace) {
          updateConfig('sections', sections);
        } else {
          updateConfig('sections', [...config.sections, ...sections]);
        }

        // Auto-expand all imported sections
        const expanded = {};
        const startIdx = shouldReplace ? 0 : config.sections.length;
        sections.forEach((_, i) => { expanded[startIdx + i] = true; });
        setExpandedSections(prev => ({ ...prev, ...expanded }));

        toast(`Imported ${sections.length} sections with ${sections.reduce((sum, s) => sum + s.items.length, 0)} items`);
        setShowImportModal(false);
        setActiveTab('sections');

      } catch (err) {
        console.error(err);
        toast('Failed to parse file: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function parseRows(rows) {
    const items = [];
    for (const row of rows) {
      const keys = Object.keys(row);

      // Find SKU column
      const skuKey = keys.find(k => /^sku$/i.test(k.trim()))
        || keys.find(k => /sku|item.?name|item.?number|part.?number|model/i.test(k));

      // Find Name/Description column
      const nameKey = keys.find(k => /description|item.?desc|product.?name|^name$/i.test(k.trim()))
        || keys.find(k => /desc|name|product|item/i.test(k) && k !== skuKey);

      // Find Price column
      const priceKey = keys.find(k => /customer.?price|selling.?price|^price$|^rate$/i.test(k.trim()))
        || keys.find(k => /price|rate|cost|amount/i.test(k) && !/commission|net/i.test(k));

      // Find Commission column
      const commKey = keys.find(k => /commission|your.?commission|comm\.?$/i.test(k.trim()))
        || keys.find(k => /commission|margin|markup/i.test(k));

      const sku = skuKey ? String(row[skuKey]).trim() : '';
      const name = nameKey ? String(row[nameKey]).trim() : '';
      const priceRaw = priceKey ? row[priceKey] : 0;
      const commRaw = commKey ? row[commKey] : 0;

      // Parse dollar amounts (strip $, commas)
      const price = parseFloat(String(priceRaw).replace(/[$,]/g, '')) || 0;
      const commission = parseFloat(String(commRaw).replace(/[$,]/g, '')) || 0;

      // Skip empty rows and header-like rows
      if (!sku && !name) continue;
      if (/^sku$/i.test(sku) || /^item$/i.test(name)) continue;

      items.push({ sku, name: name || sku, price, commission });
    }
    return items;
  }

  function generatePrintHTML() {
    const c = config;
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const totalItems = c.sections.reduce((sum, s) => sum + s.items.filter(i => i.name).length, 0);

    const sectionsHTML = c.sections.map((s) => {
      const validItems = s.items.filter(i => i.name);
      if (validItems.length === 0) return '';

      const rows = validItems.map((item, idx) => `
        <tr style="background:${idx % 2 === 0 ? '#fff' : '#f8f9fb'}">
          <td class="c-sku">${item.sku}</td>
          <td class="c-name">${item.name}</td>
          <td class="c-num">$${(+item.price).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
          <td class="c-num c-comm">$${(+item.commission) > 0 ? (+item.commission).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '\u2014'}</td>
          <td class="c-num c-net">$${(+item.price - +item.commission).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        </tr>
      `).join('');

      return `
        <table class="sec" cellspacing="0" cellpadding="0">
          <thead>
            <tr><th colspan="5" class="sec-title"><table cellspacing="0" cellpadding="0" style="width:100%"><tr>
              <td style="width:4pt;padding:0"><div style="width:4pt;height:14pt;background:${c.accentColor};border-radius:1pt"></div></td>
              <td style="padding:0 0 0 8pt;color:#fff;font-size:9.5pt;font-weight:700;letter-spacing:0.3pt">${s.title}${s.subtitle ? ' <span style="font-weight:400;font-size:7.5pt;opacity:0.6">\u2014 ' + s.subtitle + '</span>' : ''}</td>
            </tr></table></th></tr>
            <tr class="col-head">
              <th style="width:14%;text-align:left">SKU</th>
              <th style="text-align:left">Description</th>
              <th style="width:12%;text-align:right">Price</th>
              <th style="width:12%;text-align:right;color:${c.commissionColor}">Commission</th>
              <th style="width:12%;text-align:right">Net Owed</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }).join('');

    const formulaBox = c.showFormula ? `
      <table cellspacing="0" cellpadding="0" style="width:100%;margin-bottom:12pt"><tr><td style="padding:0">
        <table cellspacing="0" cellpadding="0" style="width:100%;background:${c.primaryColor}"><tr>
          <td style="padding:10pt 16pt;text-align:center">
            <div style="font-size:6pt;font-weight:700;color:${c.accentColor};text-transform:uppercase;letter-spacing:2pt;margin-bottom:3pt">How Partner Billing Works</div>
            <div style="font-size:11pt;font-weight:700;color:#fff">Customer Invoice Price &nbsp;\u2212&nbsp; <span style="color:${c.accentColor}">Your Commission</span> &nbsp;=&nbsp; Net Owed to Company</div>
          </td>
        </tr></table>
      </td></tr></table>
    ` : '';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${sheetName}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
@page { size: letter; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; }
html,body {
  font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
  font-size:8.5pt; color:#1e293b; line-height:1.35;
  -webkit-print-color-adjust:exact !important;
  print-color-adjust:exact !important;
}

/* --- Section tables --- */
table.sec {
  width:100%; border-collapse:collapse; margin-bottom:10pt;
  page-break-inside:auto;
}
table.sec thead { display:table-header-group; }
table.sec .sec-title {
  background:${c.headerBg}; padding:6pt 10pt; text-align:left;
}
table.sec .col-head th {
  padding:4pt 10pt; font-size:6pt; font-weight:800; color:#94a3b8;
  text-transform:uppercase; letter-spacing:0.8pt;
  border-bottom:1.5pt solid ${c.accentColor}; background:#f8f9fb;
}
table.sec td {
  padding:5pt 10pt; font-size:8pt; border-bottom:0.5pt solid #eef1f5;
}
table.sec .c-sku { font-family:'Courier New',monospace; font-size:7.5pt; color:#475569; }
table.sec .c-name { color:#1e293b; }
table.sec .c-num { text-align:right; font-weight:600; color:#1e293b; }
table.sec .c-comm { color:${c.commissionColor}; font-weight:700; }
table.sec .c-net { font-weight:800; color:${c.primaryColor}; }

tr { page-break-inside:avoid; break-inside:avoid; }

/* --- Screen preview --- */
@media screen {
  body { background:#1a1f2e; }
  .toolbar {
    background:${c.primaryColor}; padding:12px 20px;
    text-align:center; position:sticky; top:0; z-index:100;
    border-bottom:3px solid ${c.accentColor};
    font-family:'Inter',sans-serif;
  }
  .toolbar button {
    font-family:'Inter',sans-serif; border-radius:4px; cursor:pointer;
    font-size:13px; font-weight:700; padding:9px 24px; margin:0 4px;
  }
  .toolbar .pb { background:${c.accentColor}; color:${c.primaryColor}; border:none; }
  .toolbar .cb { background:transparent; color:#94a3b8; border:1px solid #475569; }
  .toolbar .tip { display:inline; font-size:11px; color:${c.accentColor}; margin:0 12px; }
  .toolbar .tip b { color:#fff; }
  .doc {
    width:8.5in; margin:20px auto; background:#fff;
    box-shadow:0 4px 40px rgba(0,0,0,0.5); overflow:hidden;
  }
  .doc-body { padding:0 0.5in 0.5in 0.5in; }
}
@media print {
  .toolbar { display:none !important; }
  .doc { width:auto; margin:0; box-shadow:none; }
  .doc-body { padding:0 0.5in 0.4in 0.5in; }
}
</style>
</head>
<body>
<div class="toolbar">
  <button class="pb" onclick="window.print()">\u25B6\u2002Save as PDF</button>
  <span class="tip"><b>Tip:</b> Set Margins \u2192 <b>None</b>, uncheck <b>\u201CHeaders and footers\u201D</b></span>
  <button class="cb" onclick="window.close()">Close</button>
</div>

<div class="doc">
  <!-- Header -->
  <table cellspacing="0" cellpadding="0" style="width:100%"><tr><td style="padding:0">
    <table cellspacing="0" cellpadding="0" style="width:100%;background:${c.primaryColor}">
      <tr><td colspan="3" style="height:3pt;background:${c.accentColor};font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td style="padding:22pt 0.5in 18pt;text-align:center">
        <div style="font-size:6.5pt;font-weight:700;letter-spacing:3pt;color:${c.accentColor};text-transform:uppercase;margin-bottom:5pt">\u2605\u2002${c.badge}\u2002\u2605</div>
        <div style="font-size:17pt;font-weight:900;color:#fff;letter-spacing:0.4pt;line-height:1.15">${c.companyName}</div>
        <table cellspacing="0" cellpadding="0" style="margin:6pt auto"><tr><td style="width:40pt;height:1.5pt;background:${c.accentColor}"></td></tr></table>
        <div style="font-size:9.5pt;color:${c.accentColor};font-weight:700;letter-spacing:0.6pt;margin-top:3pt">${c.title}</div>
        <div style="font-size:7.5pt;color:#94a3b8;margin-top:2pt">${c.subtitle}</div>
      </td></tr>
    </table>
  </td></tr></table>

  <!-- Info bar -->
  <table cellspacing="0" cellpadding="0" style="width:100%;background:#f8f9fb;border-bottom:1px solid #e2e8f0"><tr>
    <td style="padding:4pt 0.5in;font-size:6.5pt;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.4pt">Confidential \u2022 For Authorized Partners Only</td>
    <td style="padding:4pt 0.5in;font-size:6.5pt;color:#94a3b8;text-align:right">${today}</td>
  </tr></table>

  <!-- Body -->
  <div class="doc-body" style="padding-top:12pt">
    ${formulaBox}
    ${sectionsHTML}

    ${c.showGovernance ? `<table cellspacing="0" cellpadding="0" style="width:100%;margin-top:12pt"><tr>
      <td style="width:3pt;background:${c.accentColor}"></td>
      <td style="padding:7pt 10pt;background:#f8f9fb;font-size:6.5pt;color:#94a3b8;line-height:1.5">${c.governanceStatement}</td>
    </tr></table>` : ''}

    <table cellspacing="0" cellpadding="0" style="width:100%;margin-top:10pt;border-top:0.5pt solid #e2e8f0"><tr>
      <td style="padding:6pt 0;font-size:6.5pt;color:#cbd5e1">${c.footerText}</td>
      <td style="padding:6pt 0;font-size:6.5pt;color:#cbd5e1;text-align:right">${c.sections.length} categories \u2022 ${totalItems} items</td>
    </tr></table>
  </div>

  <!-- Bottom bar -->
  <table cellspacing="0" cellpadding="0" style="width:100%"><tr>
    <td style="height:4pt;background:${c.primaryColor};width:33%"></td>
    <td style="height:4pt;background:${c.accentColor};width:34%"></td>
    <td style="height:4pt;background:${c.primaryColor};width:33%"></td>
  </tr></table>
</div>
</body>
</html>`;
  }

  function toggleSection(idx) {
    setExpandedSections(prev => ({ ...prev, [idx]: !prev[idx] }));
  }

  const fmt = (n) => '$' + (+n).toFixed(2);

  if (!loaded) return <div style={{ padding: 48, textAlign: 'center', color: 'var(--gray-400)' }}>Loading sheet...</div>;

  const totalItems = config.sections.reduce((sum, s) => sum + s.items.filter(i => i.name).length, 0);

  return (
    <div>
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('/')} style={{ padding: '6px 10px' }}>←</button>
          <input
            type="text"
            value={sheetName}
            onChange={e => setSheetName(e.target.value)}
            style={{ fontSize: 22, fontWeight: 700, border: 'none', padding: 0, background: 'transparent', color: 'var(--navy)', outline: 'none', minWidth: 200 }}
          />
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12,
            background: saveStatus === 'error' ? 'var(--red-light)' : saveStatus === 'saving' ? 'var(--gray-100)' : 'var(--green-light)',
            color: saveStatus === 'error' ? 'var(--red)' : saveStatus === 'saving' ? 'var(--gray-500)' : 'var(--green)',
          }}>
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'error' ? 'Save failed' : '✓ Saved'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setShowImportModal(true)}>📄 Import</button>
          <button className="btn btn-outline" onClick={exportPDF}>🖨 Print / PDF</button>
        </div>
      </div>

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, background: 'var(--gray-200)', padding: 3, borderRadius: 8, width: 'fit-content' }}>
        <button
          onClick={() => setViewMode('edit')}
          style={{
            padding: '7px 20px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: viewMode === 'edit' ? 'var(--white)' : 'transparent',
            color: viewMode === 'edit' ? 'var(--navy)' : 'var(--gray-500)',
            boxShadow: viewMode === 'edit' ? 'var(--shadow-sm)' : 'none',
          }}
        >Edit</button>
        <button
          onClick={() => setViewMode('preview')}
          style={{
            padding: '7px 20px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: viewMode === 'preview' ? 'var(--white)' : 'transparent',
            color: viewMode === 'preview' ? 'var(--navy)' : 'var(--gray-500)',
            boxShadow: viewMode === 'preview' ? 'var(--shadow-sm)' : 'none',
          }}
        >Preview</button>
      </div>

      {/* EDIT MODE */}
      {viewMode === 'edit' && (
        <div>
          {/* Sub-tabs: Sections, Branding, Settings */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--gray-200)', marginBottom: 24 }}>
            {['sections', 'branding', 'settings'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: '10px 20px', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: 'none', borderBottom: activeTab === tab ? '2px solid var(--gold)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--navy)' : 'var(--gray-400)', marginBottom: -2,
                textTransform: 'capitalize',
              }}>{tab}</button>
            ))}
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 4, fontSize: 13, color: 'var(--gray-400)' }}>
              {config.sections.length} sections · {totalItems} items
            </div>
          </div>

          {/* SECTIONS TAB */}
          {activeTab === 'sections' && (
            <div>
              {config.sections.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
                  <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>📋</div>
                  <h3 style={{ fontSize: 18, color: 'var(--gray-600)', marginBottom: 6 }}>No sections yet</h3>
                  <p style={{ color: 'var(--gray-400)', marginBottom: 16, fontSize: 14 }}>Add a section manually or import from an Excel/CSV file.</p>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button className="btn btn-primary" onClick={addSection}>+ Add Section</button>
                    <button className="btn btn-outline" onClick={() => setShowImportModal(true)}>📄 Import File</button>
                  </div>
                </div>
              )}

              {config.sections.map((section, sIdx) => (
                <div key={sIdx} className="card" style={{ marginBottom: 16 }}>
                  {/* Section header */}
                  <div
                    onClick={() => toggleSection(sIdx)}
                    style={{
                      padding: '14px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      borderBottom: expandedSections[sIdx] ? '1px solid var(--gray-200)' : 'none',
                      background: 'var(--gray-50)', borderRadius: expandedSections[sIdx] ? '8px 8px 0 0' : 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: 'var(--gray-400)', fontSize: 11, transition: 'transform 0.15s', transform: expandedSections[sIdx] ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                      <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)' }}>{section.title || 'Untitled Section'}</span>
                      {section.subtitle && <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>— {section.subtitle}</span>}
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: 'rgba(201,169,110,0.15)', color: '#8B6914' }}>
                        {section.items.length} item{section.items.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                      <button className="btn btn-outline btn-sm" onClick={() => moveSection(sIdx, -1)} disabled={sIdx === 0} title="Move up">↑</button>
                      <button className="btn btn-outline btn-sm" onClick={() => moveSection(sIdx, 1)} disabled={sIdx === config.sections.length - 1} title="Move down">↓</button>
                      <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={() => removeSection(sIdx)} title="Delete section">✕</button>
                    </div>
                  </div>

                  {/* Section body */}
                  {expandedSections[sIdx] && (
                    <div style={{ padding: 20 }}>
                      {/* Section title/subtitle */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Section Title</label>
                          <input className="form-input" value={section.title} onChange={e => updateSection(sIdx, 'title', e.target.value)} />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Subtitle (optional)</label>
                          <input className="form-input" value={section.subtitle || ''} onChange={e => updateSection(sIdx, 'subtitle', e.target.value)} placeholder="e.g., Most Popular" />
                        </div>
                      </div>

                      {/* Products table */}
                      <div style={{ border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: 'var(--gray-50)' }}>
                              <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5, width: 130 }}>SKU</th>
                              <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Product Name</th>
                              <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5, width: 110 }}>Price</th>
                              <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: 0.5, width: 110 }}>Commission</th>
                              <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5, width: 110 }}>Net Owed</th>
                              <th style={{ width: 44 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {section.items.map((item, iIdx) => (
                              <tr key={iIdx} style={{ borderTop: '1px solid var(--gray-100)' }}>
                                <td style={{ padding: '6px 14px' }}>
                                  <input className="form-input form-input-sm" value={item.sku} onChange={e => updateItem(sIdx, iIdx, 'sku', e.target.value)} placeholder="SKU" style={{ fontFamily: 'monospace', fontSize: 12 }} />
                                </td>
                                <td style={{ padding: '6px 14px' }}>
                                  <input className="form-input form-input-sm" value={item.name} onChange={e => updateItem(sIdx, iIdx, 'name', e.target.value)} placeholder="Product name" />
                                </td>
                                <td style={{ padding: '6px 14px' }}>
                                  <input type="number" className="form-input form-input-sm" value={item.price} onChange={e => updateItem(sIdx, iIdx, 'price', e.target.value)} style={{ textAlign: 'right' }} />
                                </td>
                                <td style={{ padding: '6px 14px' }}>
                                  <input type="number" className="form-input form-input-sm" value={item.commission} onChange={e => updateItem(sIdx, iIdx, 'commission', e.target.value)} style={{ textAlign: 'right', color: 'var(--green)' }} />
                                </td>
                                <td style={{ padding: '6px 14px', textAlign: 'right', fontWeight: 700, fontSize: 13, color: 'var(--navy)', fontFamily: 'monospace' }}>
                                  {fmt(item.price - item.commission)}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                  <button
                                    onClick={() => removeItem(sIdx, iIdx)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', fontSize: 16, lineHeight: 1, padding: 4 }}
                                    title="Remove item"
                                    onMouseOver={e => e.target.style.color = 'var(--red)'}
                                    onMouseOut={e => e.target.style.color = 'var(--gray-400)'}
                                  >✕</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Add buttons */}
                      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                        <button className="btn btn-outline btn-sm" onClick={() => addItem(sIdx)}>+ Add Row</button>
                        <button className="btn btn-outline btn-sm" onClick={() => { setShowCatalogPicker(sIdx); setCatalogSearch(''); }}>+ From Catalog</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {config.sections.length > 0 && (
                <button className="btn btn-primary" onClick={addSection} style={{ marginTop: 4 }}>+ Add Section</button>
              )}
            </div>
          )}

          {/* BRANDING TAB */}
          {activeTab === 'branding' && (
            <div className="card" style={{ maxWidth: 640 }}>
              <div style={{ padding: 24 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Company Name</label>
                    <input className="form-input" value={config.companyName} onChange={e => updateConfig('companyName', e.target.value)} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Badge Text</label>
                    <input className="form-input" value={config.badge} onChange={e => updateConfig('badge', e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Document Title</label>
                    <input className="form-input" value={config.title} onChange={e => updateConfig('title', e.target.value)} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Subtitle</label>
                    <input className="form-input" value={config.subtitle} onChange={e => updateConfig('subtitle', e.target.value)} />
                  </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Colors</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                    {[
                      { key: 'primaryColor', label: 'Primary' },
                      { key: 'accentColor', label: 'Accent' },
                      { key: 'headerBg', label: 'Headers' },
                      { key: 'commissionColor', label: 'Commission' },
                    ].map(({ key, label }) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 6 }}>
                        <input type="color" value={config[key]} onChange={e => updateConfig(key, e.target.value)} style={{ width: 32, height: 24, border: '1px solid var(--gray-300)', borderRadius: 4, cursor: 'pointer', padding: 1 }} />
                        <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Governance Statement</label>
                  <textarea className="form-textarea" value={config.governanceStatement} onChange={e => updateConfig('governanceStatement', e.target.value)} rows={3} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Footer Text</label>
                  <input className="form-input" value={config.footerText} onChange={e => updateConfig('footerText', e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'settings' && (
            <div className="card" style={{ maxWidth: 480 }}>
              <div style={{ padding: 24 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--gray-100)', cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={config.showFormula} onChange={e => updateConfig('showFormula', e.target.checked)} style={{ width: 18, height: 18 }} />
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--navy)' }}>Show "How Partner Billing Works" box</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>Displays the commission formula at the top of the sheet</div>
                  </div>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={config.showGovernance} onChange={e => updateConfig('showGovernance', e.target.checked)} style={{ width: 18, height: 18 }} />
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--navy)' }}>Show governance statement</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>Legal/terms disclaimer at the bottom of the sheet</div>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PREVIEW MODE */}
      {viewMode === 'preview' && (
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div className="card" style={{ padding: 32 }}>
            <PreviewPane config={config} />
          </div>
        </div>
      )}

      {/* Catalog picker modal */}
      {showCatalogPicker !== null && (
        <div className="modal-overlay" onClick={() => setShowCatalogPicker(null)}>
          <div className="modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add from Product Catalog</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setShowCatalogPicker(null)}>×</button>
            </div>
            <div className="modal-body">
              <input className="form-input" placeholder="Search products..." value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} style={{ marginBottom: 12 }} autoFocus />
              <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {[...new Set(catalogProducts.map(p => p.category))].filter(Boolean).map(cat => (
                  <button key={cat} className="btn btn-outline btn-sm" onClick={() => addAllCategoryProducts(showCatalogPicker, cat)}>+ All {cat}</button>
                ))}
              </div>
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                <table>
                  <thead><tr><th>SKU</th><th>Product</th><th style={{ textAlign: 'right' }}>Price</th><th style={{ width: 60 }}></th></tr></thead>
                  <tbody>
                    {catalogProducts.filter(p => { if (!catalogSearch) return true; const q = catalogSearch.toLowerCase(); return p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q); }).slice(0, 100).map(p => (
                      <tr key={p.id}>
                        <td><code style={{ fontSize: 11 }}>{p.sku}</code></td>
                        <td>{p.name}<div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{p.category}</div></td>
                        <td style={{ textAlign: 'right' }}>${(+p.price).toFixed(2)}</td>
                        <td><button className="btn btn-primary btn-sm" onClick={() => addFromCatalog(showCatalogPicker, p)}>Add</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {catalogProducts.length === 0 && <div style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>No products in catalog. Import a CSV first.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import file modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import Pricing Sheet from File</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setShowImportModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 16, fontSize: 14, color: 'var(--gray-600)' }}>Upload an Excel or CSV file to auto-generate sections and products.</p>
              <div className="upload-area" onClick={() => importFileRef.current?.click()}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <p style={{ marginTop: 8, color: 'var(--gray-500)', fontWeight: 600 }}>Click to select file</p>
                <p style={{ fontSize: 12, color: 'var(--gray-400)' }}>.xlsx, .xls, or .csv</p>
                <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileImport} />
              </div>
              <div style={{ marginTop: 16, padding: 16, background: 'var(--gray-50)', borderRadius: 8, fontSize: 13, color: 'var(--gray-600)' }}>
                <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--navy)' }}>Supported formats:</div>
                <div style={{ marginBottom: 4 }}><strong>Multi-tab Excel</strong> — Each tab becomes a section</div>
                <div style={{ marginBottom: 4 }}><strong>Single-sheet with categories</strong> — Auto-groups by Category column</div>
                <div><strong>Simple CSV</strong> — Creates one section from all rows</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function PreviewPane({ config }) {
  const c = config;
  return (
    <div style={{ fontFamily: '-apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ background: c.primaryColor, color: 'white', padding: 20, borderRadius: 8, textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: c.accentColor, marginBottom: 4 }}>{c.badge}</div>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>{c.companyName}</div>
        <div style={{ fontSize: 13, color: c.accentColor, marginTop: 4, fontWeight: 600 }}>{c.title}</div>
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{c.subtitle}</div>
      </div>

      {/* Formula box */}
      {c.showFormula && (
        <div style={{ background: '#F8FAFC', border: `2px solid ${c.accentColor}`, borderRadius: 6, padding: '10px 16px', marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>HOW PARTNER BILLING WORKS</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.primaryColor }}>
            Customer Invoice Price − <span style={{ color: c.commissionColor }}>Your Commission</span> = Net Owed to Company
          </div>
        </div>
      )}

      {/* Sections */}
      {c.sections.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#94A3B8', fontSize: 14 }}>
          Add sections in the editor to see your pricing sheet here.
        </div>
      ) : c.sections.map((s, idx) => (
        <div key={idx} style={{ marginBottom: 16 }}>
          <div style={{ background: c.headerBg, color: 'white', padding: '7px 12px', fontSize: 12, fontWeight: 700, borderRadius: '4px 4px 0 0' }}>
            {s.title}{s.subtitle ? <span style={{ fontWeight: 400, fontSize: 10, opacity: 0.8 }}> — {s.subtitle}</span> : ''}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #E2E8F0', borderTop: 'none', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                <th style={{ padding: '5px 8px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>SKU</th>
                <th style={{ padding: '5px 8px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>ITEM</th>
                <th style={{ padding: '5px 8px', textAlign: 'right', fontSize: 9, fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>PRICE</th>
                <th style={{ padding: '5px 8px', textAlign: 'right', fontSize: 9, fontWeight: 600, color: c.commissionColor, borderBottom: '1px solid #E2E8F0' }}>COMM.</th>
                <th style={{ padding: '5px 8px', textAlign: 'right', fontSize: 9, fontWeight: 600, color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>NET</th>
              </tr>
            </thead>
            <tbody>
              {s.items.filter(i => i.name).map((item, iIdx) => (
                <tr key={iIdx}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9', fontFamily: 'monospace', fontSize: 10 }}>{item.sku}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9' }}>{item.name}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9', textAlign: 'right', fontWeight: 600 }}>${(+item.price).toFixed(2)}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9', textAlign: 'right', fontWeight: 600, color: c.commissionColor }}>
                    {(+item.commission) > 0 ? '$' + (+item.commission).toFixed(2) : 'Contact'}
                  </td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #F1F5F9', textAlign: 'right', fontWeight: 600 }}>${(+item.price - +item.commission).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Governance */}
      {c.showGovernance && c.sections.length > 0 && (
        <div style={{ marginTop: 16, padding: 10, background: '#F8FAFC', borderRadius: 4, fontSize: 9, color: '#94A3B8', textAlign: 'center' }}>
          {c.governanceStatement}
        </div>
      )}

      {/* Footer */}
      {c.sections.length > 0 && (
        <div style={{ marginTop: 8, textAlign: 'center', fontSize: 9, color: '#CBD5E1' }}>{c.footerText}</div>
      )}
    </div>
  );
}
