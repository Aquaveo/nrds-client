import React, { Component, useCallback } from 'react';
import Select, { createFilter } from 'react-select';
import { FixedSizeList as List } from 'react-window';
// import useTheme from 'hooks/useTheme';

const height = 28;

class MenuList extends Component {
  render() {
    const { options, children, maxHeight, getValue } = this.props;
    const [value] = getValue();
    const initialOffset = options.indexOf(value) * height;

    const adjustedHeight = Math.min(children.length * height, maxHeight);

    return (
      <List
        height={adjustedHeight}
        itemCount={children.length}
        itemSize={height}
        initialScrollOffset={initialOffset}
        style={{ overflowX: 'hidden' }}
      >
        {({ index, style }) => <div style={style}>{children[index]}</div>}
      </List>
    );
  }
}

const customStyles = (width = 150) => {
  return {
    container: (base) => ({
      ...base,
      width,
      fontSize: 12,
    }),
    control: (base, state) => ({
      ...base,
      minHeight: 28,
      height: 28,
      fontSize: 12,
      borderRadius: 4,
      paddingTop: 0,
      paddingBottom: 0,
      backgroundColor: 'var(--select-control-bg)',
      borderColor: state.isFocused
        ? '#2684ff'
        : 'var(--select-control-border)',
      boxShadow: state.isFocused ? '0 0 0 1px #2684ff' : 'none',
      '&:hover': {
        borderColor: '#2684ff',
      },
    }),
    valueContainer: (base) => ({
      ...base,
      padding: '0 6px',
    }),
    indicatorsContainer: (base) => ({
      ...base,
      height: 28,
    }),
    dropdownIndicator: (base) => ({
      ...base,
      padding: '0 4px',
    }),
    clearIndicator: (base) => ({
      ...base,
      padding: '0 4px',
    }),
    singleValue: (base) => ({
      ...base,
      color: 'var(--select-text-color)',
      maxWidth: '100%',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
    input: (base) => ({
      ...base,
      color: 'var(--select-text-color)',
      margin: 0,
      padding: 0,
    }),
    placeholder: (base) => ({
      ...base,
      fontSize: 12,
      color: 'var(--select-placeholder-color)',
    }),
    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
    menu: (base) => ({
      ...base,
      overflowY: 'auto',
      fontSize: 12,
      backgroundColor: 'var(--select-menu-bg)',
    }),
    menuList: (base) => ({
      ...base,
      paddingTop: 0,
      paddingBottom: 0,
    }),
    option: (base, state) => ({
      ...base,
      fontSize: 12,
      padding: '4px 8px',
      width: '100%',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      color: state.isSelected ? '#ffffff' : 'var(--select-text-color)',
      backgroundColor: state.isSelected
        ? 'var(--select-option-selected-bg)'
        : state.isFocused
        ? 'var(--select-option-hover-bg)'
        : 'var(--select-menu-bg)',
    }),
  };
};

const SelectComponent = ({
  optionsList,
  onChangeHandler,
  value,
  width = 150,
}) => {


  const handleChange = useCallback(
    (option) => {
      onChangeHandler([option]);
    },
    [onChangeHandler]
  );

  return (
    <Select
      components={{ MenuList }}
      styles={customStyles(width)}
      filterOption={createFilter({ ignoreAccents: false })}
      options={optionsList}
      value={value}
      onChange={handleChange}
      menuPortalTarget={document.body}
      menuShouldScrollIntoView={false}
      menuPosition="fixed"
    />
  );
};

export default SelectComponent;
