use Test::More tests => 12;
use Test::Differences;
use Data::Dumper;
use MolochTest;
use strict;

my $token = getTokenCookie();

my $result = system("cd ../viewer ; node addUser.js -c ../tests/config.test.ini -n testuser admin admin admin --admin");
eq_or_diff($result, "0", "script exited successfully");

system("cd ../viewer ; node addUser.js -c ../tests/config.test.ini -n testuser test1 test1 test1");
system("cd ../viewer ; node addUser.js -c ../tests/config.test.ini -n testuser test2 test2 test2 --apionly");
system("cd ../viewer ; node addUser.js -c ../tests/config.test.ini -n testuser test3 test3 test3 --email");
system("cd ../viewer ; node addUser.js -c ../tests/config.test.ini -n testuser test4 test4 test4 --expression 'ip.src == 10.0.0.1'");
system("cd ../viewer ; node addUser.js -c ../tests/config.test.ini -n testuser test5 test5 test5 --remove");
system("cd ../viewer ; node addUser.js -c ../tests/config.test.ini -n testuser test6 test6 test6 --webauth");
system("cd ../viewer ; node addUser.js -c ../tests/config.test.ini -n testuser test7 test7 test7 --packetSearch");

my $users = viewerPost("/api/users", "");

eq_or_diff($users->{recordsTotal}, 8, "Should have 9 users");
ok($users->{data}->[0]->{createEnabled}, "Admin user");
ok(!$users->{data}->[1]->{createEnabled}, "Not admin user");
ok(!$users->{data}->[2]->{webEnabled}, "API only");
ok($users->{data}->[3]->{emailSearch}, "Email Search");
eq_or_diff($users->{data}->[4]->{expression}, "ip.src == 10.0.0.1");
ok($users->{data}->[5]->{removeEnabled}, "Remove");
ok($users->{data}->[6]->{headerAuthEnabled}, "Web auth");
ok($users->{data}->[7]->{packetSearch}, "Packet search");
# TODO not sure how to test the --webauthonly flag

my $user7 = $users->{data}->[7];
system("cd ../viewer ; node addUser.js -c ../tests/config.test.ini -n testuser test7 test7 test7 --createOnly --email --remove --expression 'ip.src == 10.0.0.2'");
$users = viewerPost("/api/users", "");
eq_or_diff($users->{data}->[7], $user7, "Create only doesn't overwrite user");

my $user1 = $users->{data}->[1];
system("cd ../viewer ; node addUser.js -c ../tests/config.test.ini -n testuser test1 test1 test1 --email");
$users = viewerPost("/api/users", "");
ok($users->{data}->[1]->{emailSearch}, "Can overwrite exiting user");


# cleanup
viewerDeleteToken("/api/user/admin", $token);
viewerDeleteToken("/api/user/test1", $token);
viewerDeleteToken("/api/user/test2", $token);
viewerDeleteToken("/api/user/test3", $token);
viewerDeleteToken("/api/user/test4", $token);
viewerDeleteToken("/api/user/test5", $token);
viewerDeleteToken("/api/user/test6", $token);
viewerDeleteToken("/api/user/test7", $token);
