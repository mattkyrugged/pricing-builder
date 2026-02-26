import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../App';

const CATEGORIES = [
  'Toughbook Laptops', 'Tablets', 'Routers & Networking', 'Antennas',
  'Vehicle Docks', 'Desktop Docks', 'Vehicle Mounts', 'Printers & Supplies',
  'Batteries & Power', 'Accessories', 'Packages & Kits', 'Warranties & Protection', 'Services'
];

export default function Catalog() {
  const [products, setProducts] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showEdit, setShowEdit] = useState(null);
  const [editForm, setEditForm] = useState({ sku: '', name: '', category: '', price: 0, commission: 0 });
  const fileRef = useRef();
  const toast = useToast();

  useEffect(() => { loadProducts(); }, []);

  useEffect(() => {
    let result = products;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    }
    if (catFilter) result = result.filter(p => p.category === catFilter);
    setFiltered(result);
  }, [products, search, catFilter]);

  async function loadProducts() {
    const { data, error } = await supabase.from('products').select('*').order('category').order('name');
    if (data) { setProducts(data); setFiltered(data); }
    setLoading(false);
  }

  function openEdit(product) {
    setEditForm(product ? { ...product } : { sku: '', name: '', category: CATEGORIES[0], price: 0, commission: 0 });
    setShowEdit(product?.id || 'new');
  }

  async function saveProduct() {
    const { sku, name, category, price, commission } = editForm;
    if (!sku || !name) { toast('SKU and Name required', 'error'); return; }

    if (showEdit === 'new') {
      const { error } = await supabase.from('products').insert({ sku, name, category, price: +price, commission: +commission });
      if (error) { toast('Save failed: ' + error.message, 'error'); return; }
    } else {
      const { error } = await supabase.from('products').update({ sku, name, category, price: +price, commission: +commission }).eq('id', showEdit);
      if (error) { toast('Update failed: ' + error.message, 'error'); return; }
    }
    setShowEdit(null);
    toast(showEdit === 'new' ? 'Product added' : 'Product updated');
    loadProducts();
  }

  async function deleteProduct(id) {
    if (!confirm('Delete this product?')) return;
    await supabase.from('products').delete().eq('id', id);
    toast('Product deleted');
    loadProducts();
  }

  async function handleCSVImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) { toast('CSV appears empty', 'error'); return; }

    // Parse header
    const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const skuIdx = header.findIndex(h => h.includes('sku') || h === 'item name' || h === 'item_name');
    const nameIdx = header.findIndex(h => h.includes('description') || h === 'name' || h === 'item description');
    const priceIdx = header.findIndex(h => h.includes('selling') || h.includes('price') || h.includes('rate'));
    const catIdx = header.findIndex(h => h.includes('category') || h.includes('group'));

    if (skuIdx === -1 && nameIdx === -1) {
      toast('Could not find SKU or Name column. Check CSV format.', 'error');
      return;
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const sku = cols[skuIdx !== -1 ? skuIdx : 0]?.trim() || '';
      const name = cols[nameIdx !== -1 ? nameIdx : 1]?.trim() || '';
      const price = parseFloat(cols[priceIdx !== -1 ? priceIdx : 2]) || 0;
      const category = catIdx !== -1 ? (cols[catIdx]?.trim() || 'Uncategorized') : 'Uncategorized';

      if (sku || name) {
        rows.push({ sku, name: name || sku, price, commission: 0, category });
      }
    }

    if (rows.length === 0) { toast('No valid rows found', 'error'); return; }

    // Batch insert
    const batchSize = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from('products').insert(batch);
      if (error) { toast('Import error at row ' + (i + 1) + ': ' + error.message, 'error'); break; }
      inserted += batch.length;
    }

    toast(`Imported ${inserted} products`);
    setShowImport(false);
    loadProducts();
  }

  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
      else { current += ch; }
    }
    result.push(current);
    return result;
  }

  async function clearCatalog() {
    if (!confirm('Delete ALL products from catalog? This cannot be undone.')) return;
    if (!confirm('Are you sure? This will permanently remove all catalog products.')) return;
    const { error } = await supabase.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) { toast('Clear failed', 'error'); return; }
    toast('Catalog cleared');
    loadProducts();
  }

  const categoryCounts = products.reduce((acc, p) => { acc[p.category] = (acc[p.category] || 0) + 1; return acc; }, {});

  return (
    <div>
      <div className="page-header page-header-actions">
        <div>
          <h2>Product Catalog</h2>
          <p>{products.length} products across {Object.keys(categoryCounts).length} categories</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setShowImport(true)}>Import CSV</button>
          <button className="btn btn-gold" onClick={() => openEdit(null)}>+ Add Product</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search SKU or name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 300 }}
          />
          <select className="form-select" value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c} ({categoryCounts[c] || 0})</option>)}
          </select>
          <div style={{ flex: 1 }} />
          {products.length > 0 && (
            <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={clearCatalog}>
              Clear Catalog
            </button>
          )}
        </div>
      </div>

      {/* Products table */}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product Name</th>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>Commission</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
                  {products.length === 0 ? 'No products yet. Import a CSV or add products manually.' : 'No results match your search.'}
                </td></tr>
              ) : filtered.map(p => (
                <tr key={p.id}>
                  <td><code style={{ fontSize: 12, background: 'var(--gray-100)', padding: '2px 6px', borderRadius: 3 }}>{p.sku}</code></td>
                  <td>{p.name}</td>
                  <td><span className="badge badge-gold">{p.category}</span></td>
                  <td style={{ textAlign: 'right' }}>${(+p.price).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>${(+p.commission).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => openEdit(p)} style={{ marginRight: 4 }}>Edit</button>
                    <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)' }} onClick={() => deleteProduct(p.id)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--gray-200)', fontSize: 12, color: 'var(--gray-400)' }}>
            Showing {filtered.length} of {products.length} products
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImport && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import Products from CSV</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setShowImport(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 16, fontSize: 14, color: 'var(--gray-600)' }}>
                Upload a CSV file exported from Zoho Books. The importer will auto-detect columns for
                SKU, Name/Description, and Selling Price.
              </p>
              <div className="upload-area" onClick={() => fileRef.current?.click()}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <p style={{ marginTop: 8, color: 'var(--gray-500)' }}>Click to select CSV file</p>
                <p style={{ fontSize: 12, color: 'var(--gray-400)' }}>Supports Zoho Books Item.csv format</p>
                <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSVImport} />
              </div>
              <div style={{ marginTop: 16, padding: 12, background: 'var(--gray-50)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
                <strong>Expected columns:</strong> SKU/Item Name, Description/Name, Selling Price/Rate, Category (optional)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{showEdit === 'new' ? 'Add Product' : 'Edit Product'}</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setShowEdit(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="grid-2">
                <div className="form-group">
                  <label>SKU</label>
                  <input className="form-input" value={editForm.sku} onChange={e => setEditForm({ ...editForm, sku: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select className="form-select" value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Product Name</label>
                <input className="form-input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label>Customer Price ($)</label>
                  <input type="number" className="form-input" value={editForm.price} onChange={e => setEditForm({ ...editForm, price: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Default Commission ($)</label>
                  <input type="number" className="form-input" value={editForm.commission} onChange={e => setEditForm({ ...editForm, commission: e.target.value })} />
                </div>
              </div>
              <div style={{ padding: 12, background: 'var(--gray-50)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
                <strong>Net Owed to Company:</strong> ${(editForm.price - editForm.commission).toFixed(2)}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowEdit(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveProduct}>
                {showEdit === 'new' ? 'Add Product' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
