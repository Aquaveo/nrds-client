import styled from 'styled-components';
import { Button, Form, Modal } from 'react-bootstrap';
import { FiSearch } from 'react-icons/fi';

export const TimeSeriesContainer = styled.div`
  width: 100%;
  height: 300px;
  order: 1;
  flex: 1 1 80%;
  background-color: var(--panel-background);
`;

// Themed Modal wrapper - now fully CSS-variable based
export const ThemedModal = styled(Modal)`
  .modal-content {
    background-color: var(--modal-bg);
    color: var(--modal-text-color);
    border-radius: 12px;
  }

  .modal-header,
  .modal-footer {
    border-color: var(--modal-border-color);
  }

  .btn-primary {
    background-color: var(--button-primary-bg);
    border: none;
  }

  .btn-primary:hover,
  .btn-primary:focus {
    background-color: var(--button-primary-hover-bg);
  }

  .modal-body a {
    color: var(--link-color);
  }
`;

export const PopupContent = styled.div`
  width: 100%;
  max-width: 100%;
  padding: 8px 10px;
  background-color: var(--popup-bg);
  color: var(--popup-text-color);

  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font-size: 12px;
  line-height: 1.4;

  display: flex;
  flex-direction: column;
  gap: 4px;

  .popup-title {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 4px;
  }

  .popup-row {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }

  .popup-label {
    font-weight: 500;
    opacity: 0.8;
  }

  .popup-value {
    font-family: monospace;
    word-break: break-all;
  }
`;

export const Container = styled.div`
  position: absolute;
  top: calc(var(--ts-header-height));
  left: 0;
  height: calc(100% - var(--ts-header-height));
  width: 400px;
  padding: 20px;
  background-color: var(--background-color);
  color: var(--map-panel-text);

  z-index: 1000;
  transition: transform 0.25s ease-out;

  overflow-y: auto;

  transform: ${({ $isOpen }) =>
    $isOpen ? 'translateX(0)' : 'translateX(-100%)'};

  @media (max-width: 768px) {
    width: 100%;
    border-radius: 0;
    transform: ${({ $isOpen }) =>
      $isOpen ? 'translateX(0)' : 'translateX(-100%)'};
  }
`;

export const LayersContainer = styled.div`
  position: absolute;
  top: calc(var(--ts-header-height) + 16px);
  right: 10px;
  width: min(250px, calc(100vw - 32px));
  padding: 15px;
  background-color: var(--map-panel-bg);
  color: var(--map-panel-text);
  z-index: 1000;

  border-radius: 8px;
  overflow-y: auto;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);

  @media (max-width: 768px) {
    width: 100%;
    border-radius: 0;
  }
`;

export const CacheTableContainer = styled.div`
  position: absolute;
  top: calc(var(--ts-header-height) + 300px);
  right: 10px;
  // height: 300px;
  overflow-y: scroll;
  width: min(250px, calc(100vw - 32px));
  padding: 15px;
  background-color: var(--map-panel-bg);
  color: var(--map-panel-text);
  z-index: 1000;
  border-radius: 8px;
  font-size: 13px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  -ms-overflow-style: none;
  scrollbar-width: none;
  @media (max-width: 768px) {
    width: 100%;
    border-radius: 0;
  }
`;
export const CacheButton = styled(Button)`
  top: 360px;
  right: 1%;
  position: absolute;
  margin-top: 10px;
  transition: transform 0.3s ease;

  background-color: ${({ $bgColor = 'var(--button-primary-bg)' }) =>
    $bgColor};
  border: none;
  color: var(--accent-text);
  border-radius: 20px;
  padding: 7px 8px;
  z-index: 1001;

  &:hover,
  &:focus {
    color: var(--hover-text);
    background-color: ${({ $bgColor = 'var(--button-primary-bg)' }) => $bgColor};
    border: none;
    box-shadow: none;
  }
`;

export const LayerButton = styled(Button)`
  top: 60px;
  right: 1%;
  position: absolute;
  margin-top: 10px;
  transition: transform 0.3s ease;

  background-color: ${({ $bgColor = 'var(--button-primary-bg)' }) =>
    $bgColor};
  border: none;
  color: var(--accent-text);
  border-radius: 20px;
  padding: 7px 8px;
  z-index: 1001;

  &:hover,
  &:focus {
    color: var(--hover-text);
    background-color: ${({ $bgColor = 'var(--button-primary-bg)' }) => $bgColor};
    border: none;
    box-shadow: none;
  }
`;

export const XButton = styled(Button)`
  background: var(--accent-text, #0a0e14);
  border: 1px solid var(--border-color, #2a3a4a);
  border-radius: var(--radius-sm, 4px);
  color: var(--primary-color);
  padding: 7px 8px;
  width: 100%;
  z-index: 1001;
  box-shadow: none;
  &:hover,
  &:focus {
    background-color: var(--button-primary-hover-bg);
    color: var(--button-primary-text-hover);
    box-shadow: 0 1px 2px 0 rgba(60, 64, 67, .3), 0 1px 3px 1px rgba(60, 64, 67, .15);
  }
`;

export const SButton = styled(Button)`
  border: none;
  color: var(--accent-text);
  background-color: transparent;
  z-index: 1001;
  border-radius: 20px;
  &:hover,
  &:focus {
    background-color: var(--button-primary-hover-bg); ;
    color: var(--button-primary-text-hover);
    border: none;
    box-shadow: none;
  }
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

// Sits in the header, so it must stay compact and never push the search bar around. Failure is
// styled from last_error rather than by matching the message text. The colours come from the
// theme because the header is white in one and navy in the other -- a single hardcoded grey
// measured 1.38:1 against the dark one, which is why nothing could be read.
export const StatusStrip = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 12px;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.2;
  max-width: 32vw;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${({ $failed }) =>
    $failed ? 'var(--status-failed-text)' : 'var(--status-text)'};
  background-color: ${({ $failed }) =>
    $failed ? 'var(--status-failed-bg)' : 'var(--status-bg)'};

  /* The spinner draws itself in currentColor, so it follows the text. */
  .spinner-border {
    border-width: 2px;
  }

  @media (max-width: 768px) {
    max-width: 45vw;
    font-size: 0.85rem;
    padding: 4px 10px;
  }
`;

export const LoadingMessage = styled.div`
  color: var(--muted-text);
  padding: 10px;
  border-radius: 5px;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: bold;
  width: 100%;
  text-align: center;
  opacity: 0.8;
  transition: opacity 0.3s ease;

  &:hover {
    opacity: 1;
  }
`;

export const Row = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  margin-bottom: 2px;
  font-size: 13px;
`;

export const IconLabel = styled.span`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: ${({ $fontSize }) => ($fontSize ? `${$fontSize}px` : 'var(--text-sm)')};
  font-weight: var(--weight-medium);
  /* Explicit, because this renders as a heading in places and would inherit h2 margins. */
  margin: 0 0 4px;
  color: var(--accent-text);
`;

export const Title = styled.span`
  letter-spacing: 0.0125em;
  font-weight: var(--weight-strong);
  font-size: var(--text-md);
  line-height: 1.4;
  margin: 0;
  align-items: center;
`;

export const ToggleButton = styled(Button)`
  top: ${({ $top = 0 }) => `${$top}px`};
  left: ${(props) => (props.$currentMenu ? '410px' : '20px')};
  position: absolute;

  margin-top: 10px;

  transition: transform 0.3s ease;

  background-color: var(--button-primary-bg);
  border: none;
  color: var(--button-primary-text);
  border-radius: 5px;
  padding: 3px 10px;
  z-index: 1001;

  &:hover {
    background-color: var(--button-primary-hover-bg);
    color: var(--button-primary-text);
    border: none;
    box-shadow: none;
  }
`;

export const Switch = styled(Form.Switch)`
  .form-check-input {
    width: 34px;
    height: 18px;
    cursor: pointer;
    background-color: var(--switch-inactive);
    // border-color: var(--ascend-text);
    border-radius: 999px;
    // border: none;
    box-shadow: none;
  }

  .form-check-input:checked {
    background-color: var(--switch-active);
    border-color: var(--switch-inactive);

  }

  .form-check-input:focus {
    box-shadow: none;
    border-color: var(--switch-inactive);
  }
`;

export const Content = styled.div`
  padding: 14px 16px 18px;
  border-block-end: 1px solid var(--panel-border-color);

  /* No rule under the final section. It used to be dropped from the first one instead, which
     left the panel ending on a hanging divider. */
  &:last-of-type {
    border-block-end: none;
  }

  /* Rhythm: sections after the first breathe a little more, so the panel reads as grouped
     regions rather than one uniform stack. */
  & + & {
    padding-top: 20px;
  }

  a {
    color: var(--link-color);
  }
`;

export const MapContainer = styled.div`
  flex: 1 1 100%;
  order: 1;
  width: 100%;
  overflow-y: hidden;
  height: 100%;

  .maplibregl-popup-content {
    padding: 0px;
  }
`;

export const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

export const FieldsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
  row-gap: 8px;
`;

export const FieldBlock = styled.div``;

export const FieldLabel = styled.div`
  font-size: 12px;
  font-weight: 500;
  color: var(--accent-text);
`;

export const FieldValue = styled.div`
  font-size: 12px;
  font-weight: 500;
`;

export const SearchBarWrapper = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 400px;
  padding: 6px 10px;
  border-radius: 6px;
  background-color: var(--search-bg);
  box-sizing: border-box;
  border: 1px solid var(--search-border);
`;

export const SearchIcon = styled(FiSearch)`
  flex-shrink: 0;
  margin-right: 8px;
  color: var(--muted-text);
  font-size: 16px;
`;

export const SearchInput = styled.input`
  border: none;
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-md);
  background: transparent;
  color: var(--search-text);

  /* A visible ring rather than outline: none. Keyboard users had no indication of focus in
     the app's most-used control. Drawn inside so it cannot widen the header. */
  outline: none;
  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--nav-pill-active-bg);
    border-radius: 3px;
  }

  &::placeholder {
    color: var(--search-placeholder);
  }

  &:disabled {
    cursor: default;
  }
`;

// The search wrapper is a flex row, so this sits at its end without disturbing the input.
export const SearchButton = styled.button`
  flex-shrink: 0;
  margin-left: 8px;
  padding: 2px 10px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  color: var(--status-text);
  background-color: var(--status-bg);

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  &:not(:disabled):hover {
    filter: brightness(1.25);
  }
`;

export const ViewContainer = styled.div`
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

export const ChartContainer = styled.div`
  position: relative;
  border-radius: 10px;
  overflow: hidden;
`;

export const NoData = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-style: italic;
  font-size: 1rem;
  color: var(--chart-empty-text-color, #6b7280);
`;