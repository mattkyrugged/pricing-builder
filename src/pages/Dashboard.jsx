import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../App';

export default function Dashboard() {
  const [sheets, setSheets] = useState([]);
  const [productCount, setProductCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [sheetsRes, productsRes] = await Promise.all([
        supabase.from('sheets').select('*').order('updated_at', { ascending: false }),
        supabase.from('products').select('id', { count: 'exact', head: true }),
      ]);
      if (sheetsRes.data) setSheets(sheetsRes.data);
      if (productsRes.count !== null) setProductCount(productsRes.count);
    } catch (err) {
      toast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function deleteSheet(e, id) {
    e.stopPropagation();
    if (!confirm('Delete this sheet?')) return;
    const { error } = await supabase.from('sheets').delete().eq('id', id);
    if (error) { toast('Delete failed', 'error'); return; }
    setSheets(prev => prev.filter(s => s.id !== id));
    toast('Sheet deleted');
  }

  async function duplicateSheet(e, sheet) {
    e.stopPropagation();
    const { data, error } = await supabase.from('sheets').insert({
      name: sheet.name + ' (Copy)',
      config: sheet.config,
    }).select().single();
    if (error) { toast('Duplicate failed', 'error'); return; }
    // Copy sheet items
    const { data: items } = await supabase.from('sheet_items').select('*').eq('sheet_id', sheet.id);
    if (items?.length) {
      await supabase.from('sheet_items').insert(
        items.map(({ id, sheet_id, ...rest }) => ({ ...rest, sheet_id: data.id }))
      );
    }
    toast('Sheet duplicated');
    loadData();
  }

  function formatDate(d) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (loading) return <div className="main-content"><p>Loading...</p></div>;

  return (
    <div>
      <div className="page-header page-header-actions">
        <div>
          <h2>Dashboard</h2>
          <p>Manage your partner pricing sheets</p>
        </div>
        <button className="btn btn-gold btn-lg" onClick={() => navigate('/builder')}>
          + New Sheet
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Pricing Sheets</div>
          <div className="stat-value">{sheets.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Products in Catalog</div>
          <div className="stat-value">{productCount}</div>
          <div className="stat-sub">
            {productCount === 0 && <span>Import from Zoho CSV →</span>}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Categories</div>
          <div className="stat-value">13</div>
        </div>
      </div>

      {sheets.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <h3>No pricing sheets yet</h3>
            <p>Create your first partner pricing sheet to get started.</p>
            <button className="btn btn-primary" onClick={() => navigate('/builder')}>
              Create First Sheet
            </button>
          </div>
        </div>
      ) : (
        <div className="sheets-grid">
          {sheets.map(sheet => {
            const cfg = sheet.config || {};
            const sectionCount = cfg.sections?.length || 0;
            const itemCount = cfg.sections?.reduce((sum, s) => sum + (s.items?.length || 0), 0) || 0;
            return (
              <div key={sheet.id} className="sheet-card" onClick={() => navigate(`/builder/${sheet.id}`)}>
                <h3>{sheet.name}</h3>
                <div className="meta">
                  {sectionCount} sections · {itemCount} items · Updated {formatDate(sheet.updated_at)}
                </div>
                <div className="actions">
                  <button className="btn btn-outline btn-sm" onClick={(e) => duplicateSheet(e, sheet)}>
                    Duplicate
                  </button>
                  <button className="btn btn-outline btn-sm" style={{color: 'var(--red)'}} onClick={(e) => deleteSheet(e, sheet.id)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
