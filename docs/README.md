# SwiftBuild documentation

Start with [current status](status.md) for implemented capabilities and verification limits, and the [full roadmap](roadmap.md) for planned product work.

| Need                                         | Guide                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Run SwiftBuild locally                       | [Development](../DEVELOPMENT.md)                                                                       |
| Host the current web application             | [Self-hosting and recovery](self-hosting/README.md)                                                    |
| Understand package ownership                 | [Architecture](architecture/README.md)                                                                 |
| Import, export or migrate documents          | [Native files and archives](architecture/native-format.md)                                             |
| Model workloads and inspect evidence         | [Engineering workflow](engineering/README.md)                                                          |
| Understand formulas and unsupported behavior | [Capacity models](engineering/capacity.md)                                                             |
| Import measured data                         | [Measurement evidence](engineering/measurements.md)                                                    |
| Evaluate findings                            | [Deterministic rules](engineering/rules.md)                                                            |
| Try a worked scenario                        | [Illustrative example](engineering/example.md)                                                         |
| Author declarative packs                     | [Current extension contracts](extension-sdk/README.md)                                                 |
| Contribute or report a concern               | [Contribution guide](../CONTRIBUTING.md), [security](../SECURITY.md), [conduct](../CODE_OF_CONDUCT.md) |

Accepted architecture decisions are retained in `docs/adr/`. Package READMEs document their current public responsibilities. In-app `/guide` explains engineering findings. Neither a future roadmap entry nor an accepted decision's future consequence establishes implementation or deployment verification.
