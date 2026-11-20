import { describe, it, expect, vi, afterEach } from 'vitest';
import { proposerEspace } from '@/lib/espace-age';

const ESPACES = [
  { id: 'clas', trancheAge: '6-18 ans' },
  { id: 'collegiens', trancheAge: '11-14 ans' },
  { id: 'lyceens', trancheAge: '15 à 17 ans' },
  { id: 'pij', trancheAge: 'Tous âges' },
];

describe('proposerEspace', () => {
  afterEach(() => { vi.useRealTimers(); });
  const le = (jour: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(`${jour}T12:00:00`)); };

  it('retient l\'espace dont la tranche est la plus resserrée autour de l\'âge', () => {
    le('2026-10-12');
    expect(proposerEspace(ESPACES, '2013-01-03')).toBe('collegiens'); // 13 ans
    expect(proposerEspace(ESPACES, '2011-05-12')).toBe('lyceens');    // 15 ans
    expect(proposerEspace(ESPACES, '2018-01-01')).toBe('clas');       // 8 ans : seul le CLAS
  });

  it('ne propose rien sans certitude', () => {
    le('2026-10-12');
    expect(proposerEspace(ESPACES, '2000-01-01')).toBeNull(); // 26 ans : aucun espace
    expect(proposerEspace(ESPACES, '')).toBeNull();
    expect(proposerEspace(ESPACES, 'pas une date')).toBeNull();
    expect(proposerEspace([{ id: 'a', trancheAge: '11-14 ans' }, { id: 'b', trancheAge: '11 - 14' }], '2013-01-03')).toBeNull(); // ex æquo
    expect(proposerEspace([{ id: 'a', trancheAge: null }, { id: 'b' }], '2013-01-03')).toBeNull();
  });
});
