import React, { Fragment } from 'react';
import ForecastMenu from 'features/DataStream/components/menus/ForecastMenu';
import { CacheMenu } from './CacheMenu';

const MainMenu = () => {
  return (
    <Fragment>
        <ForecastMenu />
        <CacheMenu />
    </Fragment>
  );
};

export default MainMenu;