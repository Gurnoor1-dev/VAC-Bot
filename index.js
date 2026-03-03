require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const fetch = require('node-fetch');

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    AttachmentBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

// ================= CONFIG =================

const ADDTICKET_ROLE = "1471073279065329785";
const PANEL_BUTTON_ROLE = "1471073020444541020";
const REJECT_CHANNEL_ID = "1478324986111463527";

const DATA_FILE = path.join(__dirname, 'tickets.json');

// ================= CLIENT =================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ]
});

// ================= LOAD DATA =================

let tickets = {};
if (fs.existsSync(DATA_FILE)) {
    try {
        tickets = JSON.parse(fs.readFileSync(DATA_FILE));
    } catch {
        tickets = {};
    }
}

function saveTickets() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(tickets, null, 2));
}

function generateID(product) {
    const random = Math.random().toString(36).substring(2, 7);
    const prefix = product.includes("Polaris") ? "polaris" : "tracker";
    return `${prefix}-${random}`;
}

// ================= REGISTER COMMANDS =================

client.once('ready', async () => {

    const commands = [

        new SlashCommandBuilder()
            .setName('addticket')
            .setDescription('Add a new ticket')
            .addStringOption(o => o.setName('client').setDescription('Client Name').setRequired(true))
            .addStringOption(o => o.setName('product').setDescription('Product').setRequired(true)
                .addChoices(
                    { name: 'VACompanyPolaris™', value: 'VACompanyPolaris™' },
                    { name: 'VACompany Tracker™', value: 'VACompany Tracker™' }
                ))
            .addStringOption(o => o.setName('status').setDescription('Status').setRequired(true))
            .addStringOption(o => o.setName('requests').setDescription('Requests').setRequired(true))
            .addStringOption(o => o.setName('representative_1').setDescription('Main Representative').setRequired(true))
            .addStringOption(o => o.setName('representative_2').setDescription('Second Representative').setRequired(false))
            .addStringOption(o => o.setName('ticket_id').setDescription('Custom Ticket ID').setRequired(false)),

        new SlashCommandBuilder()
            .setName('docorder')
            .setDescription('Upload order PDF')
            .addStringOption(o => o.setName('id').setDescription('Order ID').setRequired(true))
            .addAttachmentOption(o => o.setName('file').setDescription('PDF File').setRequired(true)),

        new SlashCommandBuilder()
            .setName('panel')
            .setDescription('Send order panel')
            .addStringOption(o => o.setName('id').setDescription('Order ID').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
    );

    console.log("✅ Bot Ready");
});

// ================= INTERACTIONS =================

client.on('interactionCreate', async interaction => {

    // ================= SLASH COMMANDS =================

    if (interaction.isChatInputCommand()) {

        // ADDTICKET
        if (interaction.commandName === 'addticket') {

            if (!interaction.member.roles.cache.has(ADDTICKET_ROLE))
                return interaction.reply({ content: "No permission.", ephemeral: true });

            const customID = interaction.options.getString('ticket_id');
            const id = customID || generateID(interaction.options.getString('product'));

            tickets[id] = {
                id,
                client_name: interaction.options.getString('client'),
                product: interaction.options.getString('product'),
                status: interaction.options.getString('status'),
                requests: interaction.options.getString('requests'),
                representative_1: interaction.options.getString('representative_1'),
                representative_2: interaction.options.getString('representative_2') || null,
                last_updated: Date.now()
            };

            saveTickets();

            return interaction.reply({
                content: `✅ Ticket created: ${id}`,
                ephemeral: true
            });
        }

        // DOCORDER
        if (interaction.commandName === 'docorder') {

            if (!interaction.member.roles.cache.has(ADDTICKET_ROLE))
                return interaction.reply({ content: "No permission.", ephemeral: true });

            const id = interaction.options.getString('id');
            const file = interaction.options.getAttachment('file');

            if (!tickets[id])
                return interaction.reply({ content: "Order not found.", ephemeral: true });

            const response = await fetch(file.url);
            const buffer = Buffer.from(await response.arrayBuffer());

            fs.writeFileSync(`${id}_doc.pdf`, buffer);

            return interaction.reply({
                content: "📄 PDF saved successfully.",
                ephemeral: true
            });
        }

        // PANEL
        if (interaction.commandName === 'panel') {

            if (!interaction.member.roles.cache.has(ADDTICKET_ROLE))
                return interaction.reply({ content: "No permission.", ephemeral: true });

            const id = interaction.options.getString('id');
            const ticket = tickets[id];

            if (!ticket)
                return interaction.reply({ content: "Order not found.", ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle(`🌐 Status - ${ticket.representative_1}`)
                .addFields(
                    { name: "👨🏻‍✈️ Representatives:", value: ticket.representative_2 ? `${ticket.representative_1}\n${ticket.representative_2}` : ticket.representative_1 },
                    { name: "🗃️ Client:", value: ticket.client_name },
                    { name: "💳 Product:", value: ticket.product },
                    { name: "📊 Status:", value: ticket.status },
                    { name: "⏱️ Last Updated:", value: `<t:${Math.floor(ticket.last_updated / 1000)}:F>` }
                )
                .setFooter({ text: `VACompany | ${ticket.product.includes("Polaris") ? "Polaris™" : "Tracker™"}` })
                .setColor("Green");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`accept_${id}`)
                    .setLabel("Accept Order")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`reject_${id}`)
                    .setLabel("Reject Order")
                    .setStyle(ButtonStyle.Danger)
            );

            return interaction.reply({
                embeds: [embed],
                components: [row]
            });
        }
    }

    // ================= BUTTONS =================

    if (interaction.isButton()) {

        const [action, id] = interaction.customId.split("_");
        const ticket = tickets[id];

        if (!ticket)
            return interaction.reply({ content: "Order not found.", ephemeral: true });

        const hasPanelRole = interaction.member.roles.cache.has(PANEL_BUTTON_ROLE);
        const isRep =
            interaction.user.username === ticket.representative_1 ||
            interaction.user.username === ticket.representative_2;

        if (!hasPanelRole && !isRep)
            return interaction.reply({
                content: "❌ You are not allowed to press this button.",
                ephemeral: true
            });

        // ACCEPT
        if (action === "accept") {

            const filePath = `${id}_doc.pdf`;

            if (!fs.existsSync(filePath))
                return interaction.reply({ content: "No PDF uploaded.", ephemeral: true });

            await interaction.user.send({
                content: "📄 Here is your order document:",
                files: [filePath]
            });

            return interaction.reply({
                content: "✅ Order accepted. PDF sent to your DM.",
                ephemeral: true
            });
        }

        // REJECT
        if (action === "reject") {

            const channel = await client.channels.fetch(REJECT_CHANNEL_ID);

            const embed = new EmbedBuilder()
                .setTitle("🚨 Order Rejected")
                .addFields(
                    { name: "Client", value: ticket.client_name },
                    { name: "Order ID", value: id }
                )
                .setColor("Red");

            await channel.send({ embeds: [embed] });

            return interaction.reply({
                content: "❌ Rejection sent for review.",
                ephemeral: true
            });
        }
    }
});

// ================= LOGIN =================

client.login(process.env.TOKEN);

http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot running");
}).listen(process.env.PORT || 3000);
