// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
  useParams: () => ({}),
}))

// Extend Jest matchers with custom matchers from jest-dom
// This provides matchers like toBeInTheDocument(), toHaveAttribute(), etc.
