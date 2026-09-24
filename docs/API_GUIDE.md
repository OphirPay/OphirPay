# API Guide

All API routes must follow a single, composable pipeline to guarantee
security, logging, and error handling. The pipeline is implemented as a
set of reusable wrappers that can be composed in any order that
preserves the required semantics.

## Pipeline Overview

