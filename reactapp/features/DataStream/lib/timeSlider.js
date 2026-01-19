// Advances slider by 1 (used by playback)
// function stepForward(state, inputRef) {
//   const maxTime = state.series?.time?.length - 1 || 0;
//   state.currentTimeIndex = (state.currentTimeIndex + 1) % (maxTime + 1);
//   // inputRef.current = state.currentTimeIndex;

//   // updateTimeDisplay();
//   // updateVisualization();
//   // updateTooltipValues();
// }

// Moves slider back by 1 (used by playback)
// function stepBackward(state, inputRef) {
//   const maxTime = state.data?.time?.length - 1 || 0;

//   state.currentTimeIndex =
//     state.currentTimeIndex === 0 ? maxTime : state.currentTimeIndex - 1;
//   // inputRef.current = state.currentTimeIndex;

//   // updateTimeDisplay();
//   // updateVisualization();
//   // updateTooltipValues();
// }

// Auto-advance loop (play/pause)
// function togglePlay(state) {
//   state.isPlaying = !state.isPlaying;

//   if (state.isPlaying) {
//     state.playInterval = setInterval(() => {
//       stepForward();
//     }, 2500 / state.playSpeed);
//   } else {
//     clearInterval(state.playInterval);
//   }
// }

// function updateTimeDisplay(series, currentTimeIndex) {
//     const timeValue = series?.time?.[currentTimeIndex];
//     if (timeValue !== undefined) {
//         const hours = Math.floor(timeValue / 3600);
//         currentTimeRef.current = `T+${hours}h`;
// }


// function updateVisualization() {
//     if (!state.data || !state.pathData.length) {
//         deckgl.setProps({ layers: [] });
//         return;
//     }

//     const varData = state.data[state.selectedVariable];
//     const timeIdx = state.currentTimeIndex;

//     const pathsWithValues = state.pathData.map((p) => {
//         const value = getValueAtTime(
//             varData,
//             p.featureIndex,
//             timeIdx,
//         );
//         return {
//             ...p,
//             value: value,
//         };
//     });

//     const layers = [
//         new PathLayer({
//             id: "flowpaths",
//             data: pathsWithValues,
//             getPath: (d) => d.path,
//             getColor: (d) =>
//                 valueToColor(d.value, state.selectedVariable),
//             getWidth: (d) => {
//                 const v = d.value || 0;
//                 const bounds =
//                     state.colorBounds[state.selectedVariable];
//                 const t = Math.max(
//                     0,
//                     (v - bounds.min) / (bounds.max - bounds.min),
//                 );
//                 return 3 + t * 8;
//             },
//             widthUnits: "pixels",
//             widthMinPixels: 2,
//             widthMaxPixels: 12,
//             capRounded: true,
//             jointRounded: true,
//             pickable: true,
//             updateTriggers: {
//                 getColor: [
//                     state.currentTimeIndex,
//                     state.selectedVariable,
//                 ],
//                 getWidth: [
//                     state.currentTimeIndex,
//                     state.selectedVariable,
//                 ],
//             },
//         }),
//         // new MVTLayer({
//         //     data: "https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/styles/dark-style.json",
//         // }),
//     ];

//     deckgl.setProps({ layers });
// }


// function updateTooltipValues() {
//     if (!state.hoveredObject || !state.data) return;

//     const tooltip = document.getElementById("tooltip");
//     if (!tooltip.classList.contains("visible")) return;

//     const featureIndex = state.hoveredObject.featureIndex;
//     if (featureIndex === undefined) return;

//     updateTooltipContent({
//         id: state.hoveredObject.id,
//         featureIndex: featureIndex,
//     });
// }