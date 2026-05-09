import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: 'OK', timestamp: new Date().toISOString() })
    })
  );
});

test('renders app title', () => {
  render(<App />);
  expect(screen.getByText('SSAI Leads Pro')).toBeInTheDocument();
});
