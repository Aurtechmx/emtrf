# lidR chain: bin returns (lidR::pixel_metrics, count + mean), DTM (lidR::rasterize_terrain, TIN),
# distance to data (terra::distance), contour (isoband::isolines), simplify (sf::st_simplify,
# Douglas-Peucker without topology preservation).
# Usage: Rscript run_lidr.R WORKDIR SITE_ID XMIN YMIN XMAX YMAX CELL
suppressPackageStartupMessages({library(lidR); library(terra); library(isoband); library(sf)})
a <- commandArgs(TRUE); W <- a[1]; S <- a[2]; v <- as.numeric(a[3:7]); X0 <- v[1]; Y0 <- v[2]; X1 <- v[3]; Y1 <- v[4]; C <- v[5]
D <- file.path(W, "lidr", S); unlink(D, recursive = TRUE); dir.create(D, recursive = TRUE)
p <- read.csv(file.path(W, paste0(S, ".csv")))
las <- suppressWarnings(LAS(data.frame(X = p$x, Y = p$y, Z = p$z, Classification = 2L)))
tmpl <- rast(xmin = X0, xmax = X1, ymin = Y0, ymax = Y1, resolution = C, crs = "")
pm <- pixel_metrics(las, ~list(n = length(Z), z = mean(Z)), res = tmpl)
dtm <- suppressWarnings(rasterize_terrain(las, res = tmpl, algorithm = tin()))
dist <- distance(pm$n) / C
write_asc <- function(r, f) {
  m <- as.matrix(r, wide = TRUE); m[is.na(m)] <- -9999
  stopifnot(nrow(m) == round((Y1 - Y0) / C), ncol(m) == round((X1 - X0) / C), abs(xmin(r) - X0) < 1e-6, abs(ymin(r) - Y0) < 1e-6)
  writeLines(c(sprintf("ncols %d", ncol(m)), sprintf("nrows %d", nrow(m)), sprintf("xllcorner %.10f", X0), sprintf("yllcorner %.10f", Y0),
               sprintf("cellsize %.10f", C), "nodata_value -9999", apply(m, 1, function(row) paste(format(row, digits = 15, trim = TRUE), collapse = " "))), f)
}
n <- pm$n; n[is.na(n)] <- 0
write_asc(n, file.path(D, "count.asc")); write_asc(dist, file.path(D, "dist.asc")); write_asc(dtm, file.path(D, "dtm.asc"))
z <- as.matrix(dtm, wide = TRUE)[nrow(dtm):1, ]                 # south to north
xs <- X0 + (seq_len(ncol(z)) - 0.5) * C; ys <- Y0 + (seq_len(nrow(z)) - 0.5) * C
lv <- seq(ceiling(min(z, na.rm = TRUE) / C) * C, floor(max(z, na.rm = TRUE) / C) * C, by = C)
iso <- isolines(xs, ys, z, lv)
src <- list(); simp <- list()
for (k in seq_along(lv)) {
  L <- iso[[k]]; if (!length(L$x)) next
  for (id in unique(L$id)) {
    sel <- L$id == id; xy <- cbind(L$x[sel], L$y[sel]); if (nrow(xy) < 2) next
    g <- st_linestring(xy); s <- st_simplify(st_sfc(g), preserveTopology = FALSE, dTolerance = C)[[1]]
    src[[length(src) + 1]] <- list(level = lv[k], xy = xy); simp[[length(simp) + 1]] <- list(level = lv[k], xy = unclass(s))
  }
}
gj <- function(L, f) {
  feats <- vapply(L, function(e) sprintf('{"type":"Feature","properties":{"level":%.10g},"geometry":{"type":"LineString","coordinates":[%s]}}',
    e$level, paste(sprintf("[%.10f,%.10f]", e$xy[, 1], e$xy[, 2]), collapse = ",")), "")
  writeLines(sprintf('{"type":"FeatureCollection","features":[%s]}', paste(feats, collapse = ",")), f)
}
gj(src, file.path(D, "contours.geojson")); gj(simp, file.path(D, "simplified.geojson"))
