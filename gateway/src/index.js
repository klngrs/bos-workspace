import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Widget } from "near-social-vm";
import "bootstrap-icons/font/bootstrap-icons.css";
import "react-bootstrap-typeahead/css/Typeahead.css";
import "react-bootstrap-typeahead/css/Typeahead.bs5.css";
import "bootstrap/dist/js/bootstrap.bundle";
import "index.scss";
import useRedirectMap from "./useRedirectMap";
import {
  Link,
  Route,
  Routes,
  useLocation,
  BrowserRouter,
} from "react-router-dom";
import { useHashRouterLegacy } from "./useHashRouterLegacy";
import { useAuth } from "./useAuth";
import { NavigationWrapper } from "./navigation/NavigationWrapper";

function Viewer({ widgetSrc, code }) {
  const [widgetProps, setWidgetProps] = useState({});
  const location = useLocation();

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    setWidgetProps(
      Array.from(searchParams.entries()).reduce((props, [key, value]) => {
        props[key] = value;
        return props;
      }, {}),
    );
  }, [location]);

  let src;

  if (!code) {
    // prioritize code if provided
    src = widgetSrc || location.pathname.substring(1);
    if (src) {
      src = src.substring(src.lastIndexOf("/", src.indexOf(".near")) + 1);
    } else {
      src = "sking.near/widget/Explorer";
    }
  }

  const { components: redirectMap } = useRedirectMap();

  return (
    <div className="container-xl">
      <div className="row">
        <div
          className="position-relative"
          style={{
            "--body-top-padding": "24px",
            paddingTop: "var(--body-top-padding)",
          }}
        >
          <Widget
            src={src}
            code={code}
            props={widgetProps}
            config={{ redirectMap }}
          />
        </div>
      </div>
    </div>
  );
}

function Home() {
  const { components: redirectMap } = useRedirectMap();
  const widgets = {};
  Object.keys(redirectMap).forEach((key) => {
    const parts = key.split("/widget/");
    if (!widgets[parts[0]]) {
      widgets[parts[0]] = [];
    }
    widgets[parts[0]].push(parts[1]);
  });

  return (
    <div className="container">
      <div className="row mt-3 mb-2">
        <span>Your local widgets:</span>
      </div>
      <div className="row mb-2">
        <ul className="list-group">
          {Object.keys(widgets).length === 0 && (
            <li className="list-group-item">No widgets found</li>
          )}
          {Object.keys(widgets).map((acc) => (
            <details className="list-group-item" key={acc}>
              <summary className="cursor-pointer">{acc}</summary>
              <ul>
                {widgets[acc].map((key) => (
                  <li key={key}>
                    <Link
                      to={`${acc}/widget/${key}`}
                    >{`${acc}/widget/${key}`}</Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </ul>
      </div>
    </div>
  );
}

function App(props) {
  useHashRouterLegacy();

  const passProps = useAuth();
  const { EthersProviderContext, ethersProviderContext } = passProps;

  return (
    <EthersProviderContext.Provider value={ethersProviderContext}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="*"
          element={
            <>
              <NavigationWrapper {...passProps} />
              <Viewer {...passProps} />
            </>
          }
        />
      </Routes>
    </EthersProviderContext.Provider>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
