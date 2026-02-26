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
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!id);
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [showCatalogPicker, setShowCatalogPicker] = useState(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const importFileRef = useRef();

  // Load existing sheet
  useEffect(() => {
    if (id) {
      loadSheet(id);
    }
    loadCatalog();
  }, [id]);

  async function loadSheet(sheetId) {
    const { data, error } = await supabase.from('sheets').select('*').eq('id', sheetId).single();
    if (error || !data) { toast('Sheet not found', 'error'); navigate('/'); return; }
    setSheetName(data.name);
    setConfig({ ...DEFAULT_CONFIG, ...data.config });
    setLoaded(true);
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

  async function saveSheet() {
    setSaving(true);
    try {
      if (id) {
        const { error } = await supabase.from('sheets').update({
          name: sheetName, config, updated_at: new Date().toISOString()
        }).eq('id', id);
        if (error) throw error;
        toast('Sheet saved');
      } else {
        const { data, error } = await supabase.from('sheets').insert({
          name: sheetName, config
        }).select().single();
        if (error) throw error;
        toast('Sheet created');
        navigate(`/builder/${data.id}`, { replace: true });
      }
    } catch (err) {
      toast('Save failed: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function exportPDF() {
    const html = generatePrintHTML();
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
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
    const sectionsHTML = c.sections.map(s => {
      const rows = s.items.filter(i => i.name).map(item => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #E2E8F0;font-size:11px;font-family:monospace">${item.sku}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #E2E8F0;font-size:11px">${item.name}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #E2E8F0;text-align:right;font-size:11px;font-weight:600">$${(+item.price).toFixed(2)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #E2E8F0;text-align:right;font-size:11px;color:${c.commissionColor};font-weight:600">${(+item.commission) > 0 ? '$' + (+item.commission).toFixed(2) : 'Contact'}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #E2E8F0;text-align:right;font-size:11px;font-weight:600">$${(+item.price - +item.commission).toFixed(2)}</td>
        </tr>
      `).join('');

      return `
        <div style="margin-bottom:16px;break-inside:avoid">
          <div style="background:${c.headerBg};color:white;padding:8px 12px;font-size:13px;font-weight:700;border-radius:4px 4px 0 0">
            ${s.title}${s.subtitle ? ` <span style="font-weight:400;font-size:11px;opacity:0.8">— ${s.subtitle}</span>` : ''}
          </div>
          <table style="width:100%;border-collapse:collapse;border:1px solid #E2E8F0;border-top:none">
            <thead>
              <tr style="background:#F8FAFC">
                <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748B;border-bottom:1px solid #E2E8F0;width:100px">SKU</th>
                <th style="padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:#64748B;border-bottom:1px solid #E2E8F0">ITEM</th>
                <th style="padding:6px 10px;text-align:right;font-size:10px;font-weight:600;color:#64748B;border-bottom:1px solid #E2E8F0;width:90px">PRICE</th>
                <th style="padding:6px 10px;text-align:right;font-size:10px;font-weight:600;color:${c.commissionColor};border-bottom:1px solid #E2E8F0;width:90px">COMMISSION</th>
                <th style="padding:6px 10px;text-align:right;font-size:10px;font-weight:600;color:#64748B;border-bottom:1px solid #E2E8F0;width:90px">NET OWED</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }).join('');

    const formulaBox = c.showFormula ? `
      <div style="background:#F8FAFC;border:2px solid ${c.accentColor};border-radius:6px;padding:12px 16px;margin:16px 0;text-align:center">
        <div style="font-size:11px;color:#64748B;margin-bottom:4px">HOW PARTNER BILLING WORKS</div>
        <div style="font-size:14px;font-weight:700;color:${c.primaryColor}">
          Customer Invoice Price − <span style="color:${c.commissionColor}">Your Commission</span> = Net Owed to ${c.companyName.split(' ')[0]}
        </div>
      </div>
    ` : '';

    return `<!DOCTYPE html><html><head><title>${sheetName}</title>
      <style>@page{size:letter;margin:0.4in}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>
    </head><body style="padding:0.4in">
      <div style="text-align:center;margin-bottom:8px">
        <div style="background:${c.primaryColor};color:white;padding:16px;border-radius:8px">
          <div style="font-size:10px;letter-spacing:2px;color:${c.accentColor};margin-bottom:4px">${c.badge}</div>
          <div style="font-size:20px;font-weight:800;letter-spacing:1px">${c.companyName}</div>
          <div style="font-size:14px;color:${c.accentColor};margin-top:4px;font-weight:600">${c.title}</div>
          <div style="font-size:11px;color:#94A3B8;margin-top:2px">${c.subtitle}</div>
        </div>
      </div>
      ${formulaBox}
      ${sectionsHTML}
      ${c.showGovernance ? `<div style="margin-top:16px;padding:10px;background:#F8FAFC;border-radius:4px;font-size:10px;color:#94A3B8;text-align:center">${c.governanceStatement}</div>` : ''}
      <div style="margin-top:8px;text-align:center;font-size:10px;color:#CBD5E1">${c.footerText}</div>
    </body></html>`;
  }

  function toggleSection(idx) {
    setExpandedSections(prev => ({ ...prev, [idx]: !prev[idx] }));
  }

  const fmt = (n) => '$' + (+n).toFixed(2);

  if (!loaded) return <div><p>Loading sheet...</p></div>;

  return (
    <div>
      <div className="page-header page-header-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="text"
            className="form-input"
            value={sheetName}
            onChange={e => setSheetName(e.target.value)}
            style={{ fontSize: 20, fontWeight: 700, border: 'none', padding: 0, background: 'transparent', color: 'var(--navy)', width: 'auto', minWidth: 200 }}
          />
          <span className="badge badge-gold">{id ? 'Saved' : 'Draft'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => navigate('/')}>← Back</button>
          <button className="btn btn-outline" onClick={() => setShowImportModal(true)}>📄 Import File</button>
          <button className="btn btn-outline" onClick={exportPDF}>🖨 Print / PDF</button>
          <button className="btn btn-gold" onClick={saveSheet} disabled={saving}>
            {saving ? 'Saving...' : '💾 Save Sheet'}
          </button>
        </div>
      </div>

      <div className="builder-layout">
        {/* Sidebar editor */}
        <div className="builder-sidebar">
          <div className="card">
            <div style={{ padding: '0 16px' }}>
              <div className="tabs">
                <button className={`tab ${activeTab === 'sections' ? 'active' : ''}`} onClick={() => setActiveTab('sections')}>Sections</button>
                <button className={`tab ${activeTab === 'branding' ? 'active' : ''}`} onClick={() => setActiveTab('branding')}>Branding</button>
                <button className={`tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>Settings</button>
              </div>
            </div>

            <div className="card-body">
              {/* SECTIONS TAB */}
              {activeTab === 'sections' && (
                <div>
                  {config.sections.length === 0 && (
                    <div className="empty-state" style={{ padding: 24 }}>
                      <h3>No sections yet</h3>
                      <p>Add a section to start building your pricing sheet.</p>
                    </div>
                  )}

                  {config.sections.map((section, sIdx) => (
                    <div key={sIdx} className="section-card">
                      <div className="section-card-header" onClick={() => toggleSection(sIdx)}>
                        <h4>
                          <span style={{ fontSize: 10, color: 'var(--gray-400)' }}>☰</span>
                          {section.title || 'Untitled Section'}
                          <span className="badge badge-gold" style={{ fontSize: 10 }}>{section.items.length}</span>
                        </h4>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); moveSection(sIdx, -1); }} disabled={sIdx === 0}>↑</button>
                          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); moveSection(sIdx, 1); }} disabled={sIdx === config.sections.length - 1}>↓</button>
                          <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={(e) => { e.stopPropagation(); removeSection(sIdx); }}>×</button>
                        </div>
                      </div>

                      {expandedSections[sIdx] && (
                        <div className="section-card-body">
                          <div className="grid-2" style={{ marginBottom: 12 }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label>Section Title</label>
                              <input className="form-input form-input-sm" value={section.title} onChange={e => updateSection(sIdx, 'title', e.target.value)} />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label>Subtitle (optional)</label>
                              <input className="form-input form-input-sm" value={section.subtitle || ''} onChange={e => updateSection(sIdx, 'subtitle', e.target.value)} placeholder="e.g., Most Popular" />
                            </div>
                          </div>

                          {/* Product rows header */}
                          <div className="product-row product-row-header">
                            <span>SKU</span><span>Name</span><span>Price</span><span>Comm.</span><span>Net</span><span></span>
                          </div>

                          {section.items.map((item, iIdx) => (
                            <div key={iIdx} className="product-row">
                              <input className="form-input form-input-sm" value={item.sku} onChange={e => updateItem(sIdx, iIdx, 'sku', e.target.value)} placeholder="SKU" />
                              <input className="form-input form-input-sm" value={item.name} onChange={e => updateItem(sIdx, iIdx, 'name', e.target.value)} placeholder="Product name" />
                              <input type="number" className="form-input form-input-sm" value={item.price} onChange={e => updateItem(sIdx, iIdx, 'price', e.target.value)} />
                              <input type="number" className="form-input form-input-sm" value={item.commission} onChange={e => updateItem(sIdx, iIdx, 'commission', e.target.value)} />
                              <span className="text-sm" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(item.price - item.commission)}</span>
                              <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)', padding: '2px 6px' }} onClick={() => removeItem(sIdx, iIdx)}>×</button>
                            </div>
                          ))}

                          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                            <button className="btn btn-outline btn-sm" onClick={() => addItem(sIdx)}>+ Add Row</button>
                            <button className="btn btn-outline btn-sm" onClick={() => { setShowCatalogPicker(sIdx); setCatalogSearch(''); }}>
                              + From Catalog
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <button className="btn btn-primary" style={{ width: '100%' }} onClick={addSection}>
                    + Add Section
                  </button>
                </div>
              )}

              {/* BRANDING TAB */}
              {activeTab === 'branding' && (
                <div>
                  <div className="form-group">
                    <label>Company Name</label>
                    <input className="form-input" value={config.companyName} onChange={e => updateConfig('companyName', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Document Title</label>
                    <input className="form-input" value={config.title} onChange={e => updateConfig('title', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Subtitle</label>
                    <input className="form-input" value={config.subtitle} onChange={e => updateConfig('subtitle', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Badge Text</label>
                    <input className="form-input" value={config.badge} onChange={e => updateConfig('badge', e.target.value)} />
                  </div>

                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--gray-700)', marginBottom: 8, marginTop: 16 }}>Colors</label>
                  <div className="color-row">
                    <label>Primary</label>
                    <input type="color" value={config.primaryColor} onChange={e => updateConfig('primaryColor', e.target.value)} />
                  </div>
                  <div className="color-row">
                    <label>Accent</label>
                    <input type="color" value={config.accentColor} onChange={e => updateConfig('accentColor', e.target.value)} />
                  </div>
                  <div className="color-row">
                    <label>Section Headers</label>
                    <input type="color" value={config.headerBg} onChange={e => updateConfig('headerBg', e.target.value)} />
                  </div>
                  <div className="color-row">
                    <label>Commission</label>
                    <input type="color" value={config.commissionColor} onChange={e => updateConfig('commissionColor', e.target.value)} />
                  </div>

                  <div className="form-group" style={{ marginTop: 16 }}>
                    <label>Governance Statement</label>
                    <textarea className="form-textarea" value={config.governanceStatement} onChange={e => updateConfig('governanceStatement', e.target.value)} rows={3} />
                  </div>
                  <div className="form-group">
                    <label>Footer Text</label>
                    <input className="form-input" value={config.footerText} onChange={e => updateConfig('footerText', e.target.value)} />
                  </div>
                </div>
              )}

              {/* SETTINGS TAB */}
              {activeTab === 'settings' && (
                <div>
                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={config.showFormula} onChange={e => updateConfig('showFormula', e.target.checked)} />
                      Show "How Partner Billing Works" box
                    </label>
                  </div>
                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={config.showGovernance} onChange={e => updateConfig('showGovernance', e.target.checked)} />
                      Show governance statement
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Preview pane */}
        <div className="builder-preview">
          <div style={{ padding: 24 }}>
            <PreviewPane config={config} />
          </div>
        </div>
      </div>

      {/* Catalog picker modal */}
      {showCatalogPicker !== null && (
        <div className="modal-overlay" onClick={() => setShowCatalogPicker(null)}>
          <div className="modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add from Product Catalog</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setShowCatalogPicker(null)}>×</button>
            </div>
            <div className="modal-body">
              <input
                className="form-input"
                placeholder="Search products..."
                value={catalogSearch}
                onChange={e => setCatalogSearch(e.target.value)}
                style={{ marginBottom: 12 }}
                autoFocus
              />

              {/* Quick add by category */}
              <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {[...new Set(catalogProducts.map(p => p.category))].filter(Boolean).map(cat => (
                  <button key={cat} className="btn btn-outline btn-sm" onClick={() => addAllCategoryProducts(showCatalogPicker, cat)}>
                    + All {cat}
                  </button>
                ))}
              </div>

              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Product</th>
                      <th style={{ textAlign: 'right' }}>Price</th>
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalogProducts
                      .filter(p => {
                        if (!catalogSearch) return true;
                        const q = catalogSearch.toLowerCase();
                        return p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q);
                      })
                      .slice(0, 100)
                      .map(p => (
                        <tr key={p.id}>
                          <td><code style={{ fontSize: 11 }}>{p.sku}</code></td>
                          <td>
                            {p.name}
                            <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{p.category}</div>
                          </td>
                          <td style={{ textAlign: 'right' }}>${(+p.price).toFixed(2)}</td>
                          <td>
                            <button className="btn btn-primary btn-sm" onClick={() => addFromCatalog(showCatalogPicker, p)}>Add</button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {catalogProducts.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>
                    No products in catalog. Import a CSV first.
                  </div>
                )}
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
              <p style={{ marginBottom: 16, fontSize: 14, color: 'var(--gray-600)' }}>
                Upload an Excel or CSV file to auto-generate sections and products.
              </p>

              <div className="upload-area" onClick={() => importFileRef.current?.click()}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <p style={{ marginTop: 8, color: 'var(--gray-500)', fontWeight: 600 }}>Click to select file</p>
                <p style={{ fontSize: 12, color: 'var(--gray-400)' }}>.xlsx, .xls, or .csv</p>
                <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileImport} />
              </div>

              <div style={{ marginTop: 16, padding: 16, background: 'var(--gray-50)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--gray-600)' }}>
                <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--navy)' }}>Supported formats:</div>
                <div style={{ marginBottom: 6 }}>
                  <strong>Multi-tab Excel</strong> — Each tab becomes a section (like the KY Rugged pricing sheet)
                </div>
                <div style={{ marginBottom: 6 }}>
                  <strong>Single-sheet with categories</strong> — Auto-groups by Category/Section column
                </div>
                <div style={{ marginBottom: 6 }}>
                  <strong>Simple CSV</strong> — Creates one section from all rows
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-400)' }}>
                  Auto-detects columns: SKU, Name/Description, Price, Commission
                </div>
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
