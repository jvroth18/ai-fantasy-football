import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';

describe('application shell', () => {
  it('presents the local front office entry point', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'ai-fantasy-football' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create your first team' })).toBeInTheDocument();
  });
});
