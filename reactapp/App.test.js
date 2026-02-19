import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import App from 'App';
import tethysAPI from 'features/Tethys/services/api/tethys';

jest.mock('features/DataStream/views/DatastreamView', () => () => (
  <div data-testid="datastream-view" />
));

jest.mock('features/DataStream/components/map/SearchBar', () => () => (
  <div data-testid="search-bar" />
));

jest.mock('features/Tethys/services/api/tethys', () => ({
  __esModule: true,
  default: {
    getAppData: jest.fn(),
    getUserData: jest.fn(),
    getJWTToken: jest.fn(),
    getCSRF: jest.fn(),
  },
}));

const renderWithRouter = (ui, { route = '/' } = {}) => {
  const rawBase = process.env.TETHYS_APP_ROOT_URL || '/';
  const basename = rawBase.replace(/\/+$/, '') || '/';
  return render(
    <MemoryRouter initialEntries={[route]} basename={basename}>
      {ui}
    </MemoryRouter>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  tethysAPI.getAppData.mockResolvedValue({
    title: 'NRDS',
    icon: '/static/nrds/images/icon.png',
    exitUrl: '/apps/',
    rootUrl: '/apps/nrds/',
  });
  tethysAPI.getUserData.mockResolvedValue({ isAuthenticated: true });
  tethysAPI.getJWTToken.mockResolvedValue({ access: 'access', refresh: 'refresh' });
  tethysAPI.getCSRF.mockResolvedValue('csrf-token');
});

it('renders the app shell on the home route', async () => {
  renderWithRouter(<App />);

  const title = await screen.findByText(/NRDS/i);
  expect(title).toBeInTheDocument();

  const view = await screen.findByTestId('datastream-view');
  expect(view).toBeInTheDocument();
});

it('renders the Not Found page on unknown routes', async () => {
  renderWithRouter(<App />, { route: '/missing' });

  const notFound = await screen.findByText(/Page Not Found/i);
  expect(notFound).toBeInTheDocument();
});
