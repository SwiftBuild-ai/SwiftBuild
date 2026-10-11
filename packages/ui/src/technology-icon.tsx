import {
  siPostgresql,
  siMysql,
  siMariadb,
  siMongodb,
  siRedis,
  siApachekafka,
  siRabbitmq,
  siNginx,
  siCloudflare,
  siCockroachlabs,
  siSqlite,
  siApachepulsar,
  siNatsdotio,
  siGooglecloudstorage,
  siElasticsearch,
  siOpensearch,
  siClickhouse,
  siSnowflake,
  siKubernetes,
  siDocker,
  siPrometheus,
  siGrafana,
  siOpentelemetry,
} from 'simple-icons';
const brands = {
  postgresql: siPostgresql,
  mysql: siMysql,
  mariadb: siMariadb,
  mongodb: siMongodb,
  redis: siRedis,
  kafka: siApachekafka,
  rabbitmq: siRabbitmq,
  nginx: siNginx,
  cloudflare: siCloudflare,
  cockroachdb: siCockroachlabs,
  sqlite: siSqlite,
  pulsar: siApachepulsar,
  nats: siNatsdotio,
  gcs: siGooglecloudstorage,
  elasticsearch: siElasticsearch,
  opensearch: siOpensearch,
  clickhouse: siClickhouse,
  snowflake: siSnowflake,
  kubernetes: siKubernetes,
  docker: siDocker,
  prometheus: siPrometheus,
  grafana: siGrafana,
  opentelemetry: siOpentelemetry,
};
const symbols: Record<string, string> = {
  database:
    'M4 7C4 3 20 3 20 7V17C20 21 4 21 4 17Z M4 7C4 11 20 11 20 7 M4 12C4 16 20 16 20 12',
  cache: 'M13 2L5 14H11L10 22L19 10H13Z',
  queue: 'M4 5H8V19H4Z M10 5H14V19H10Z M16 5H20V19H16Z',
  service: 'M3 4H21V10H3Z M3 14H21V20H3Z M7 7H8 M7 17H8',
  worker: 'M3 4H21V10H3Z M3 14H21V20H3Z M10 12H14',
  client: 'M3 3H21V17H3Z M8 21H16 M12 17V21',
  boundary: 'M2 2H22V22H2Z M7 7H17V17H7Z',
  'load-balancer': 'M12 3V9 M3 14L12 9L21 14 M3 14V21 M21 14V21 M12 9V21',
  haproxy: 'M2 7H17L13 3 M17 7L13 11 M22 17H7L11 13 M7 17L11 21',
  cassandra: 'M2 12Q12 1 22 12Q12 23 2 12 M8 12A4 4 0 1 0 16 12A4 4 0 1 0 8 12',
  memcached: 'M3 18V6L8 12L12 6L16 12L21 6V18',
  valkey: 'M2 4L12 21L22 4 M8 4L12 11L16 4',
  lambda: 'M5 3H10L19 21H22 M10 12L4 21',
  ec2: 'M6 6H18V18H6Z M9 1V6 M15 1V6 M9 18V23 M15 18V23 M1 9H6 M1 15H6 M18 9H23 M18 15H23',
  s3: 'M3 5L6 21H18L21 5 M3 5Q12 -1 21 5Q12 11 3 5 M9 13H15',
  rds: 'M5 7C5 3 19 3 19 7V17C19 21 5 21 5 17Z M5 7C5 11 19 11 19 7 M2 12H5 M19 12H22',
  dynamodb: 'M12 2L22 12L12 22L2 12Z M7 7H17V17H7Z',
  sqs: 'M2 4H8V20H2Z M16 4H22V20H16Z M8 12H16 M12 8L16 12L12 16',
  sns: 'M11 3V9 M11 9L3 17 M11 9L21 17 M11 9V21 M1 17H5 M19 17H23',
  azureblob: 'M3 6L12 1L21 6V18L12 23L3 18Z M3 6L12 11L21 6 M12 11V23',
};
export function TechnologyIcon({
  icon,
  size = 24,
  label,
}: {
  icon: string;
  size?: number;
  label?: string;
}) {
  const brand = brands[icon as keyof typeof brands];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="technology-icon"
      style={{ color: `var(--icon-${icon}, currentColor)` }}
    >
      {brand ? (
        <path d={brand.path} fill="currentColor" />
      ) : (
        <path
          d={symbols[icon] ?? symbols.service}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
