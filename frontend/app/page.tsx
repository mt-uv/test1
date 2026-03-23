"use client";

import { useEffect, useRef, useState } from "react";
import CrystalViewer from "./components/CrystalViewer";

const API_BASE =
  process.env.NEXT_PUBLIC_RAILWAY_API_URL || "http://localhost:8000";

type PreviewResponse = {
  filename: string;
  n_atoms: number;
  cif: string;
};

type AppTab = "explorer" | "relax" | "md";
type PotentialOption = "uma" | "orb";

const EXAMPLE_CIF = `data_Si2V1
_symmetry_space_group_name_H-M   'P1'
_cell_length_a   9.295831
_cell_length_b   6.197221
_cell_length_c   10.898132
_cell_angle_alpha   90.000000
_cell_angle_beta    90.000000
_cell_angle_gamma   120.000000
_cell_volume   543.710732
_cell_formula_units_Z   1
loop_
 _atom_site_label
 _atom_site_type_symbol
 _atom_site_fract_x
 _atom_site_fract_y
